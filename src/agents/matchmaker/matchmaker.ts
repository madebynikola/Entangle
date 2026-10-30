import { createAgent, type Agent } from "@mozaik-ai/core"
import { createTask, join, modelFor, runTask, state } from "../../runtime"
import type { CompanyNeed, NoMatch, PairCandidate, RejectedClaim, ResearcherProfile, SentBack, Task } from "../../types"
import { SentBackToMe, describeRejections, postArtifact, sentBackTask } from "../critic/protocol"
import { matchmakerResponder } from "./mock"
import {
	MATCHMAKER_INSTRUCTION,
	MATCH_SCHEMA,
	PAIR_FIX_SCHEMA,
	matchMessage,
	pairFixMessage,
	type MatchAnswer,
	type MatchInput,
	type PairFixInput,
} from "./prompt"
import { shortlist } from "./select"
import { EventOfType, applyClaimFixes, emit, parseJson, registerMockResponder, type ClaimFix } from "./shared"

export interface MatchmakerOptions {
	/** Default: the role's model from config/models.ts. */
	model?: string
	/** Participant name; give each one its own when you run several. */
	name?: string
	/** Candidates per challenge when match() gets none: a shortlist from `state.profiles`. */
	shortlistSize?: number
	/** Default: 6000 for a match, 3000 for a fix. Anthropic needs a value. */
	maxOutputTokens?: number
}

export interface Matchmaker {
	agent: Agent
	/**
	 * Match one challenge. Candidates default to a shortlist from the blackboard.
	 * A "not-research" challenge, or one with no candidates, becomes a NoMatch without a model call.
	 * Pairs land in `state.candidates` and are posted to the Critic; a NoMatch lands in `state.noMatches` (`match.none`).
	 */
	match(need: CompanyNeed, candidates?: ResearcherProfile[]): Task
	/** Fix the rejected claims of a pair without the Critic's send-back (e.g. in a test). Null for an unknown pair. */
	fix(pairId: string, rejected: RejectedClaim[]): Task | null
}

type Job = { type: "match"; input: MatchInput; message: string } | { type: "fix"; input: PairFixInput; message: string }

/**
 * Create the Matchmaker agent and join it to the runtime. It answers `critic.sent_back` for its own pairs
 * by itself. In a mock run it registers its canned answers on the mock runner.
 */
export function createMatchmaker(options: MatchmakerOptions): Matchmaker {
	const jobs = new Map<string, Job>()
	const agent = createAgent({
		name: options.name ?? "matchmaker",
		capabilities: ["inference", "matchmaker"],
		instruction: MATCHMAKER_INSTRUCTION,
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
	if (state().mock) registerMockResponder(matchmakerResponder)

	const run = (task: Task, job: Job, note = "") => {
		jobs.set(task.id, job)
		const structuredOutput = job.type === "match" ? MATCH_SCHEMA : PAIR_FIX_SCHEMA
		runTask(task, job.message + note, { model: options.model ?? modelFor("matchmaker"), structuredOutput, maxOutputTokens: options.maxOutputTokens ?? (job.type === "match" ? 6000 : 3000) })
	}

	function match(need: CompanyNeed, candidates?: ResearcherProfile[]): Task {
		const s = state()
		const task = createTask("match", agent, need.challengeId)
		const pool = candidates ?? shortlist(need, [...s.profiles.values()], options.shortlistSize)
		if (need.triage === "not-research") return settleWithoutModel(task, need, `Not a research problem: ${need.triageReason}`)
		if (pool.length === 0) return settleWithoutModel(task, need, "No researcher in the data works on this problem.")
		const input: MatchInput = { need, candidates: pool }
		run(task, { type: "match", input, message: matchMessage(input) })
		return task
	}

	function fix(pairId: string, rejected: RejectedClaim[]): Task | null {
		return startFix(createTask("match", agent, pairId), pairId, rejected)
	}

	function sentBack(payload: SentBack): void {
		if (payload.kind !== "pair") return
		startFix(sentBackTask(payload), payload.id, payload.rejected, describeRejections(payload))
	}

	function startFix(task: Task, pairId: string, rejected: RejectedClaim[], critique = ""): Task | null {
		const s = state()
		const pair = s.candidates.get(pairId)
		if (!pair) return null
		const input: PairFixInput = { pair, rejected, need: s.needs.get(pair.challengeId), profile: s.profiles.get(pair.researcherId) }
		run(task, { type: "fix", input, message: pairFixMessage(input) + (critique && `\n\n${critique}`) })
		return task
	}

	function settleWithoutModel(task: Task, need: CompanyNeed, reason: string): Task {
		const now = Date.now()
		Object.assign(task, { status: "done", attempts: 1, startedAt: now, finishedAt: now, output: JSON.stringify({ outcome: "no-match", reason }) })
		recordNoMatch(task, { challengeId: need.challengeId, reason })
		return task
	}

	function recordNoMatch(task: Task, noMatch: NoMatch): void {
		state().noMatches.set(noMatch.challengeId, noMatch)
		emit(agent.getId(), "match.none", { taskId: task.id, challengeId: noMatch.challengeId, reason: noMatch.reason })
	}

	function completed(taskId: string): void {
		const job = jobs.get(taskId)
		const task = state().tasks.get(taskId)
		if (!job || !task) return
		jobs.delete(taskId)
		try {
			if (job.type === "match") applyMatch(task, job.input, parseJson<MatchAnswer>(task.output))
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
		task.status = "failed"
		task.error = error
		emit(agent.getId(), "task.failed", { taskId: task.id, error })
	}

	function applyMatch(task: Task, input: MatchInput, answer: MatchAnswer): void {
		const s = state()
		const { need } = input
		const byId = new Map(input.candidates.map((profile) => [profile.researcherId, profile]))
		if (!Array.isArray(answer.pairs)) throw new Error("pairs is not a list")

		// Only candidates we gave the model can form a pair; one pair per researcher.
		const pairs = new Map<string, MatchAnswer["pairs"][number]>()
		if (answer.outcome !== "no-match") {
			for (const pair of answer.pairs) if (byId.has(pair.researcherId) && !pairs.has(pair.researcherId)) pairs.set(pair.researcherId, pair)
		}
		const invented = answer.pairs.filter((pair) => !byId.has(pair.researcherId)).map((pair) => pair.researcherId)
		if (invented.length) emit(agent.getId(), "match.dropped", { taskId: task.id, challengeId: need.challengeId, researcherIds: invented, reason: "not a candidate" })

		if (pairs.size === 0) {
			const reason = answer.noMatchReason?.trim() || "No candidate's evidence addresses the core of this problem."
			recordNoMatch(task, { challengeId: need.challengeId, reason })
			return
		}
		s.noMatches.delete(need.challengeId)
		for (const pair of pairs.values()) {
			const profile = byId.get(pair.researcherId)!
			const candidate: PairCandidate = {
				id: `${need.challengeId}:${pair.researcherId}`,
				challengeId: need.challengeId,
				companyId: need.companyId,
				researcherId: pair.researcherId,
				fit: Math.min(1, Math.max(0, Number(pair.fit) || 0)),
				why: pair.why ?? [],
				problem: pair.problem,
				risks: pair.risks ?? [],
			}
			if (!profile.canLead && !candidate.risks.some((risk) => /lead|supervis/i.test(risk.text))) {
				candidate.risks.push({ text: `${profile.name} can advise but should not lead the project or supervise.`, sourceIds: [profile.researcherId] })
			}
			s.candidates.set(candidate.id, candidate)
			postArtifact("pair", candidate.id, agent.getId(), task.id)
		}
	}

	function applyFix(task: Task, input: PairFixInput, answer: ClaimFix[]): void {
		const s = state()
		if (!Array.isArray(answer)) throw new Error("fixes is not a list")
		// The Critic may have dropped the pair meanwhile.
		if (!s.candidates.has(input.pair.id)) return
		const pair: PairCandidate = { ...input.pair, why: [...input.pair.why], risks: [...input.pair.risks] }
		const problem = [pair.problem]
		const missing = applyClaimFixes([problem, pair.why, pair.risks], input.rejected, answer)
		if (missing.length) emit(agent.getId(), "fix.unmatched", { taskId: task.id, id: pair.id, rejected: missing })

		if (problem.length === 0 || pair.why.length === 0) {
			s.candidates.delete(pair.id)
			emit(agent.getId(), "pair.dropped", { taskId: task.id, pairId: pair.id, reason: "no supported problem or reason left after the fix" })
			return
		}
		pair.problem = problem[0]
		s.candidates.set(pair.id, pair)
		postArtifact("pair", pair.id, agent.getId(), task.id)
	}

	return { agent, match, fix }
}
