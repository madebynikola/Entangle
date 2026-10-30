import { createAgent, type Agent } from "@mozaik-ai/core"
import { createTask, failTask, join, modelFor, runTask, state } from "../../runtime"
import type { Claim, PairCandidate, Proposal, ProposalKind, RejectedClaim, SentBack, SourceStore, Task } from "../../types"
import { SentBackToMe, describeRejections, postArtifact, sentBackTask } from "../critic/protocol"
import { EventOfType, applyClaimFixes, emit, parseJson, registerMockResponder, type ClaimFix } from "../matchmaker/shared"
import { writerResponder } from "./mock"
import {
	PROPOSAL_FIX_SCHEMA,
	PROPOSAL_SCHEMA,
	WRITER_INSTRUCTION,
	proposalFixMessage,
	writeMessage,
	type ProposalDraft,
	type ProposalFixInput,
	type WriteInput,
} from "./prompt"
import { draftClaims, renderProposal, scrubId, type RenderContext } from "./render"

export interface WriterOptions {
	/** Default: the role's model from config/models.ts. */
	model?: string
	/** Participant name; give each writer its own (`writer-1`, `writer-2`, ...). */
	name?: string
	/** Adds source titles to each proposal's Sources list. */
	sources?: SourceStore
	/** Default: 10000 for a proposal, 3000 for a fix. Anthropic needs a value. */
	maxOutputTokens?: number
	/** Mock runs only: plant one invented claim in the first draft, so a mock trace shows the Critic loop. */
	mockPlantFakeClaim?: boolean
}

export interface Writer {
	agent: Agent
	/**
	 * Write the proposal for a pair on the blackboard (its need and profile must be there too).
	 * The proposal lands in `state.proposals` as `${challengeId}-${researcherId}` and is posted to the Critic.
	 */
	write(pairId: string): Task | null
	/** Fix the rejected claims of a proposal without the Critic's send-back (e.g. in a test). */
	fix(proposalId: string, rejected: RejectedClaim[]): Task | null
}

type Job = { type: "write"; input: WriteInput; message: string } | { type: "fix"; input: ProposalFixInput; message: string }

interface Entry {
	draft: ProposalDraft
	context: RenderContext
}

export const proposalId = (pair: Pick<PairCandidate, "challengeId" | "researcherId">) => `${pair.challengeId}-${pair.researcherId}`

/** Create one Proposal Writer and join it. It answers `critic.sent_back` for its own proposals by itself. */
export function createWriter(options: WriterOptions): Writer {
	const jobs = new Map<string, Job>()
	const entries = new Map<string, Entry>()
	const agent = createAgent({
		name: options.name ?? "writer",
		capabilities: ["inference", "writer"],
		instruction: WRITER_INSTRUCTION,
		tools: [],
		handlers: [
			{
				specification: new EventOfType("task.completed"),
				processor: { apply: ({ event }) => completed((event.payload as { taskId: string }).taskId) },
			},
			{
				specification: new SentBackToMe(),
				processor: { apply: ({ event }) => sentBack(event.payload as SentBack) },
			},
		],
	})
	join(agent)
	if (state().mock) registerMockResponder(writerResponder({ plantFakeClaim: options.mockPlantFakeClaim }))

	const run = (task: Task, job: Job, note = "") => {
		jobs.set(task.id, job)
		const structuredOutput = job.type === "write" ? PROPOSAL_SCHEMA : PROPOSAL_FIX_SCHEMA
		runTask(task, job.message + note, { model: options.model ?? modelFor("writer"), structuredOutput, maxOutputTokens: options.maxOutputTokens ?? (job.type === "write" ? 10000 : 3000) })
	}

	function write(pairId: string): Task | null {
		const s = state()
		const pair = s.candidates.get(pairId)
		const need = pair && s.needs.get(pair.challengeId)
		const researcher = pair && s.profiles.get(pair.researcherId)
		if (!pair || !need || !researcher) return null
		// Only a researcher who can lead may supervise, and only a research problem is a PhD topic.
		const allowedKinds: ProposalKind[] =
			researcher.canLead && need.triage === "research" ? ["industrial-phd", "joint-project"] : ["joint-project"]
		const input: WriteInput = { pair, need, researcher, allowedKinds }
		const task = createTask("write", agent, proposalId(pair))
		run(task, { type: "write", input, message: writeMessage(input) })
		return task
	}

	function fix(id: string, rejected: RejectedClaim[]): Task | null {
		return startFix(createTask("write", agent, id), id, rejected)
	}

	function sentBack(payload: SentBack): void {
		if (payload.kind !== "proposal") return
		startFix(sentBackTask(payload), payload.id, payload.rejected, describeRejections(payload))
	}

	function startFix(task: Task, id: string, rejected: RejectedClaim[], critique = ""): Task | null {
		const entry = entries.get(id)
		if (!entry) return null
		const { draft, context } = entry
		const input: ProposalFixInput = {
			proposalId: id,
			draft: { problem: draft.problem, companyBrings: draft.companyBrings, researcherBrings: draft.researcherBrings, whyThisPair: draft.whyThisPair },
			rejected,
			evidence: { need: context.need, researcher: context.researcher, pair: context.pair },
		}
		run(task, { type: "fix", input, message: proposalFixMessage(input) + (critique && `\n\n${critique}`) })
		return task
	}

	function completed(taskId: string): void {
		const job = jobs.get(taskId)
		const task = state().tasks.get(taskId)
		if (!job || !task) return
		jobs.delete(taskId)
		try {
			if (job.type === "write") applyWrite(task, job.input, parseJson<ProposalDraft>(task.output))
			else applyFix(task, job.input, parseJson<{ fixes: ClaimFix[] }>(task.output).fixes)
		} catch (error) {
			retryOrFail(task, job, error instanceof Error ? error.message : String(error))
		}
	}

	/** A bad answer gets another attempt with the error attached, up to the budget's maxAttempts. */
	function retryOrFail(task: Task, job: Job, error: string): void {
		if (task.attempts < state().budget.maxAttempts) {
			emit(agent.getId(), "task.retry", { taskId: task.id, error })
			run(task, job, `\n\nYour previous answer could not be used (${error}). Answer again with valid JSON for the schema.`)
			return
		}
		// The tracker marked the task done on the model's answer. Reopen it so failTask settles it and wakes whenSettled.
		task.status = "running"
		failTask(task, error)
	}

	function applyWrite(task: Task, input: WriteInput, answer: ProposalDraft): void {
		const draft = normalize(answer, input.allowedKinds)
		if (!draft.title || !draft.problem.length || !draft.whyThisPair.length || !draft.plan.length) {
			throw new Error("the proposal needs a title, a problem, a plan and why this pair")
		}
		// The proposal keeps its own copy of the pair's risks, so a fix to one never changes the other.
		const context: RenderContext = { pair: { ...input.pair, risks: [...input.pair.risks] }, need: input.need, researcher: input.researcher, sources: options.sources }
		const id = proposalId(input.pair)
		const previous = state().proposals.get(id)
		publish(task, id, { draft, context }, previous ? previous.revision + 1 : 0)
	}

	function applyFix(task: Task, input: ProposalFixInput, answer: ClaimFix[]): void {
		if (!Array.isArray(answer)) throw new Error("fixes is not a list")
		const entry = entries.get(input.proposalId)
		const current = state().proposals.get(input.proposalId)
		// The Critic may have dropped the proposal meanwhile.
		if (!entry || !current) return
		const draft = structuredClone(entry.draft)
		const context: RenderContext = { ...entry.context, pair: { ...entry.context.pair, risks: [...entry.context.pair.risks] } }
		const missing = applyClaimFixes([draft.problem, draft.companyBrings, draft.researcherBrings, draft.whyThisPair, context.pair.risks], input.rejected, answer)

		// An id the Critic found only in free text ("The proposal text cites X.") is removed from it.
		const unmatched = missing.filter((index) => {
			const cited = input.rejected[index].claim.text.match(/^The proposal text cites (.+)\.$/)
			if (!cited) return true
			for (const id of input.rejected[index].claim.sourceIds) scrubDraft(draft, id)
			return false
		})
		if (unmatched.length) emit(agent.getId(), "fix.unmatched", { taskId: task.id, id: input.proposalId, rejected: unmatched })

		if (!draft.problem.length || !draft.whyThisPair.length) {
			state().proposals.delete(input.proposalId)
			entries.delete(input.proposalId)
			emit(agent.getId(), "proposal.dropped", { taskId: task.id, proposalId: input.proposalId, reason: "no supported problem or reason left after the fix" })
			return
		}
		publish(task, input.proposalId, { draft, context }, current.revision + 1)
	}

	function publish(task: Task, id: string, entry: Entry, revision: number): void {
		const proposal: Proposal = {
			id,
			pairId: entry.context.pair.id,
			kind: entry.draft.kind,
			title: entry.draft.title,
			markdown: renderProposal(entry.draft, entry.context),
			claims: draftClaims(entry.draft, entry.context),
			revision,
		}
		entries.set(id, entry)
		state().proposals.set(id, proposal)
		postArtifact("proposal", id, agent.getId(), task.id)
	}

	return { agent, write, fix }
}

/** Start one proposal per pair, spread over the writers so their loops run side by side. Skips pairs that are not on the blackboard. */
export function writeAll(writers: Writer[], pairIds: string[]): Task[] {
	return pairIds.flatMap((pairId, i) => writers[i % writers.length].write(pairId) ?? [])
}

function normalize(answer: ProposalDraft, allowedKinds: ProposalKind[]): ProposalDraft {
	const list = <T>(value: T[] | undefined) => (Array.isArray(value) ? value : [])
	const claims = (value: Claim[] | undefined) =>
		list(value).filter((claim) => claim?.text?.trim()).map((claim) => ({ text: claim.text.trim(), sourceIds: list(claim.sourceIds) }))
	return {
		kind: allowedKinds.includes(answer.kind) ? answer.kind : allowedKinds[0],
		title: String(answer.title ?? "").trim(),
		problem: claims(answer.problem),
		researchQuestions: list(answer.researchQuestions),
		approach: list(answer.approach),
		plan: list(answer.plan).filter((row) => row?.period && row.work),
		firstSixMonths: list(answer.firstSixMonths),
		companyBrings: claims(answer.companyBrings),
		researcherBrings: claims(answer.researcherBrings),
		pairReasoning: String(answer.pairReasoning ?? "").trim(),
		whyThisPair: claims(answer.whyThisPair),
		agreedUpFront: list(answer.agreedUpFront),
	}
}

function scrubDraft(draft: ProposalDraft, id: string): void {
	draft.title = scrubId(draft.title, id)
	draft.pairReasoning = scrubId(draft.pairReasoning, id)
	for (const key of ["researchQuestions", "approach", "firstSixMonths", "agreedUpFront"] as const) {
		draft[key] = draft[key].map((text) => scrubId(text, id))
	}
	draft.plan = draft.plan.map((row) => ({ period: row.period, work: scrubId(row.work, id), result: scrubId(row.result, id) }))
}
