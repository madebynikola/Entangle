import { createAgent, type Agent } from "@mozaik-ai/core"
import { shardCompanies, type Dataset } from "../../data"
import { createTask, join, modelFor, runTask, state } from "../../runtime"
import type { Claim, CompanyNeed, RejectedClaim, SentBack, Task } from "../../types"
import { SentBackToMe, describeRejections, postArtifact, sentBackTask } from "../critic/protocol"
import { EventOfType, applyClaimFixes, emit, parseJson, registerMockResponder, type ClaimFix } from "../matchmaker/shared"
import { ClaimFilter, reportCleaned, retryOrFail } from "../profiler/shared"
import { analystResponder } from "./mock"
import {
	ANALYST_INSTRUCTION,
	NEED_FIX_SCHEMA,
	NEED_SCHEMA,
	TRIAGES,
	analyzeMessage,
	companyBundle,
	needFixMessage,
	type NeedAnswer,
	type NeedDraft,
	type NeedFixInput,
} from "./prompt"

export interface AnalystOptions {
	data: Dataset
	/** Default: the role's model from config/models.ts, picked per task (spread over the providers with a key). */
	model?: string
	/** Participant name; give each one its own (`analyst-1`, `analyst-2`, ...). */
	name?: string
	/** Default: 8000 for a company, 2000 for a fix. */
	maxOutputTokens?: number
	/** Mock runs only: plant one invented claim in the first need, so a mock trace shows the Critic's send-back. */
	mockPlantFakeClaim?: boolean
}

export interface Analyst {
	agent: Agent
	/**
	 * Read one company (profile, challenges, pages) in one loop and write a CompanyNeed per challenge to
	 * `state.needs`. Each need is posted to the Critic as it lands.
	 */
	analyze(companyId: string): Task
	/** Fix the rejected claims of a need without the Critic's send-back (e.g. in a test). Null for an unknown need. */
	fix(challengeId: string, rejected: RejectedClaim[]): Task | null
}

type Job =
	| { type: "analyze"; companyId: string; message: string }
	| { type: "fix"; input: NeedFixInput; message: string }

/** Search terms per need. The model is asked for 5 to 10. */
const MAX_TERMS = 12

const PLANTED: Omit<Claim, "sourceIds"> = { text: "The company runs its own particle accelerator for radiation tests." }

/**
 * Create one Industry Analyst and join it. It answers `critic.sent_back` for its own needs by itself.
 * In a mock run it registers its canned answers on the mock runner.
 */
export function createAnalyst(options: AnalystOptions): Analyst {
	const { data } = options
	const jobs = new Map<string, Job>()
	let planted = false
	const agent = createAgent({
		name: options.name ?? "analyst",
		capabilities: ["inference", "analyst"],
		instruction: ANALYST_INSTRUCTION,
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
	if (state().mock) registerMockResponder(analystResponder)

	const run = (task: Task, job: Job, note = "") => {
		jobs.set(task.id, job)
		const structuredOutput = job.type === "analyze" ? NEED_SCHEMA : NEED_FIX_SCHEMA
		const maxOutputTokens = options.maxOutputTokens ?? (job.type === "analyze" ? 8000 : 2000)
		runTask(task, job.message + note, { model: options.model ?? modelFor("analyst"), structuredOutput, maxOutputTokens })
	}

	function analyze(companyId: string): Task {
		const message = analyzeMessage(companyBundle(data, companyId))
		const task = createTask("analyze", agent, companyId)
		run(task, { type: "analyze", companyId, message })
		return task
	}

	function fix(challengeId: string, rejected: RejectedClaim[]): Task | null {
		return startFix(createTask("analyze", agent, challengeId), challengeId, rejected)
	}

	function sentBack(payload: SentBack): void {
		if (payload.kind !== "need") return
		startFix(sentBackTask(payload), payload.id, payload.rejected, describeRejections(payload))
	}

	function startFix(task: Task, challengeId: string, rejected: RejectedClaim[], critique = ""): Task | null {
		const need = state().needs.get(challengeId)
		if (!need) return null
		const input: NeedFixInput = { need, rejected, company: companyBundle(data, need.companyId) }
		run(task, { type: "fix", input, message: needFixMessage(input) + (critique && `\n\n${critique}`) })
		return task
	}

	function completed(taskId: string): void {
		const job = jobs.get(taskId)
		const task = state().tasks.get(taskId)
		if (!job || !task) return
		jobs.delete(taskId)
		try {
			if (job.type === "analyze") applyAnalysis(task, job.companyId, parseJson<NeedAnswer>(task.output))
			else applyFix(task, job.input, parseJson<{ fixes: ClaimFix[] }>(task.output).fixes)
		} catch (error) {
			retryOrFail(agent.getId(), task, error instanceof Error ? error.message : String(error), (note) => run(task, job, note))
		}
	}

	/** Only the ids of this company's own records count: the company, its challenges, its pages. */
	function companyRecord(companyId: string, id: string): string | undefined {
		if (id === companyId) return id
		const challenge = data.challenges.get(id)
		if (challenge) return challenge.companyId === companyId ? id : undefined
		const page = data.page(id)
		return page?.companyId === companyId ? page.id : undefined
	}

	function applyAnalysis(task: Task, companyId: string, answer: NeedAnswer): void {
		const s = state()
		const company = data.companies.get(companyId)!
		if (!Array.isArray(answer?.needs)) throw new Error("needs is not a list")
		const drafts = new Map<string, NeedDraft>()
		for (const draft of answer.needs) {
			const id = typeof draft?.challengeId === "string" ? draft.challengeId.trim() : ""
			if (company.challenges.includes(id) && !drafts.has(id)) drafts.set(id, draft)
		}
		const missing = company.challenges.filter((id) => !drafts.has(id))
		// Ask again for a full answer; on the last attempt, keep what came back.
		if (missing.length && task.attempts < s.budget.maxAttempts) throw new Error(`it has no need for ${missing.join(", ")}`)
		if (missing.length) emit(agent.getId(), "analysis.missing", { taskId: task.id, companyId, challengeIds: missing })

		for (const [challengeId, draft] of drafts) {
			const filter = new ClaimFilter((id) => companyRecord(companyId, id))
			const need: CompanyNeed = {
				challengeId,
				companyId,
				companyName: company.name,
				sector: company.sector,
				triage: TRIAGES.includes(draft.triage) ? draft.triage : "research",
				triageReason: typeof draft.triageReason === "string" ? draft.triageReason.trim() : "",
				restatement: restatementOf(challengeId, filter.one(draft.restatement)),
				searchTerms: termsOf(draft.searchTerms),
				assets: filter.list(draft.assets),
				constraints: filter.list(draft.constraints),
			}
			if (state().mock && options.mockPlantFakeClaim && !planted) {
				planted = true
				need.assets.push({ ...PLANTED, sourceIds: [companyId] })
			}
			reportCleaned(agent.getId(), task, challengeId, filter)
			s.needs.set(challengeId, need)
			postArtifact("need", challengeId, agent.getId(), task.id)
		}
	}

	function applyFix(task: Task, input: NeedFixInput, fixes: ClaimFix[]): void {
		const s = state()
		if (!Array.isArray(fixes)) throw new Error("fixes is not a list")
		const { challengeId, companyId } = input.need
		// The Critic may have dropped the need meanwhile.
		const current = s.needs.get(challengeId)
		if (!current) return
		const restatement = [current.restatement]
		const assets = [...current.assets]
		const constraints = [...current.constraints]
		const missing = applyClaimFixes([restatement, assets, constraints], input.rejected, fixes)
		if (missing.length) emit(agent.getId(), "fix.unmatched", { taskId: task.id, id: challengeId, rejected: missing })

		const filter = new ClaimFilter((id) => companyRecord(companyId, id))
		const need: CompanyNeed = {
			...current,
			restatement: restatementOf(challengeId, filter.one(restatement[0])),
			assets: filter.list(assets),
			constraints: filter.list(constraints),
		}
		reportCleaned(agent.getId(), task, challengeId, filter)
		s.needs.set(challengeId, need)
		postArtifact("need", challengeId, agent.getId(), task.id)
	}

	/** The restatement restates the challenge, so it always cites it. With none left, the challenge's own line. */
	function restatementOf(challengeId: string, claim: Claim | null): Claim {
		if (!claim) return { text: data.challenges.get(challengeId)!.text, sourceIds: [challengeId] }
		return { text: claim.text, sourceIds: [challengeId, ...claim.sourceIds.filter((id) => id !== challengeId)] }
	}

	return { agent, analyze, fix }
}

function termsOf(raw: unknown): string[] {
	const terms = (Array.isArray(raw) ? raw : []).filter((t): t is string => typeof t === "string").map((t) => t.replace(/\s+/g, " ").trim())
	return [...new Map(terms.filter(Boolean).map((t) => [t.toLowerCase(), t])).values()].slice(0, MAX_TERMS)
}

/** `n` Analysts named `analyst-1` … `analyst-n`. */
export function createAnalysts(n: number, options: Omit<AnalystOptions, "name">): Analyst[] {
	return Array.from({ length: Math.max(1, n) }, (_, i) =>
		createAnalyst({ ...options, name: `analyst-${i + 1}`, mockPlantFakeClaim: options.mockPlantFakeClaim && i === 0 }),
	)
}

/**
 * Split the companies into one id range per Analyst (near-equal token size) and start every company at once:
 * one loop per company, all in parallel. The runner's rate limits decide how many calls are in flight.
 */
export function analyzeCompanies(analysts: Analyst[], data: Dataset, companyIds: string[] = [...data.companies.keys()]): Task[] {
	return shardCompanies(data, analysts.length, companyIds).flatMap((shard) => shard.ids.map((id) => analysts[shard.index].analyze(id)))
}
