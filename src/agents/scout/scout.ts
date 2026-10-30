import { readFileSync } from "node:fs"
import { createAgent, type Agent } from "@mozaik-ai/core"
import { createEuCalls, savedEuCalls, SAVED_CALLS, type EuCalls } from "../../data/eucalls"
import { budgetSpent, createTask, failTask, join, modelFor, runTask, state } from "../../runtime"
import type { CompanyNeed, FundingCall, FundingFit, FundingMatch, PairCandidate, ResearcherProfile, Task } from "../../types"
import { EventOfType, emit, parseJson, registerMockResponder } from "../matchmaker/shared"
import { scoutResponder } from "./mock"
import { FUNDING_SCHEMA, QUERIES_SCHEMA, SCOUT_INSTRUCTION, queriesMessage, scoutInput, scoutMessage, type FundingAnswer, type QueriesInput, type ScoutInput } from "./prompt"

export interface ScoutOptions {
	/** Default: the live portal, or the saved calls in a mock run (no network). */
	calls?: EuCalls
	/** Default: the role's model from config/models.ts. */
	model?: string
	name?: string
}

export interface Scout {
	agent: Agent
	/** The portal client, so the run can save each call it cites. */
	calls: EuCalls
	/** Start on a chosen pair: write the queries, search the portal, pick the calls. Returns the first task, or null. */
	scout(pairId: string): Task | null
	/** Every pair's answer so far. */
	results(): FundingMatch[]
}

/** Calls the Scout reads per pair: the portal's best matches with a deadline ahead. */
const MAX_CALLS = 24
const MAX_FITS = 3
const MAX_QUERIES = 4

interface Subject {
	pair: PairCandidate
	need: CompanyNeed
	researcher: ResearcherProfile
}

type Job =
	| { type: "queries"; subject: Subject; input: QueriesInput }
	| { type: "pick"; base: Omit<FundingMatch, "calls">; input: ScoutInput; calls: FundingCall[] }

/**
 * Create the Funding Scout and join it. It reacts to `orchestrator.decided` by itself: when a company's pair goes
 * to a Writer, the Scout works on that pair at the same time, in two steps. First its model writes a few queries
 * in the EU's own vocabulary, since EU topics are broad and a researcher's terms often miss them. Then the code
 * searches the EU Funding & Tenders portal with those queries and the need's search terms, and the model picks the
 * calls that fit from the answer. Each result lands on `MatchState.funding` and is announced with `funding.posted`.
 */
export function createScout(options: ScoutOptions = {}): Scout {
	const jobs = new Map<string, Job>()
	const started = new Set<string>()
	const calls = options.calls ?? (state().mock ? savedEuCalls(JSON.parse(readFileSync(SAVED_CALLS, "utf8")) as FundingCall[]) : createEuCalls())
	const agent = createAgent({
		name: options.name ?? "scout",
		capabilities: ["inference", "scout"],
		instruction: SCOUT_INSTRUCTION,
		tools: [],
		handlers: [
			{
				specification: new EventOfType("orchestrator.decided"),
				processor: {
					apply: ({ event }) => {
						const pairId = (event.payload as { pairId?: string | null }).pairId
						if (pairId) scout(pairId)
					},
				},
			},
			{
				specification: new EventOfType("task.completed"),
				processor: { apply: ({ event }) => completed((event.payload as { taskId: string }).taskId) },
			},
		],
	})
	join(agent)
	if (state().mock) registerMockResponder(scoutResponder())

	const run = (task: Task, job: Job, note = "") => {
		jobs.set(task.id, job)
		const message = job.type === "queries" ? queriesMessage(job.input) : scoutMessage(job.input)
		const structuredOutput = job.type === "queries" ? QUERIES_SCHEMA : FUNDING_SCHEMA
		runTask(task, message + note, { model: options.model ?? modelFor("scout"), structuredOutput, maxOutputTokens: job.type === "queries" ? 300 : 1500 })
	}

	function scout(pairId: string): Task | null {
		if (started.has(pairId)) return null
		started.add(pairId)
		const s = state()
		const pair = s.candidates.get(pairId)
		const need = pair && s.needs.get(pair.challengeId)
		const researcher = pair && s.profiles.get(pair.researcherId)
		if (!pair || !need || !researcher || budgetSpent()) return null
		const task = createTask("scout", agent, pairId)
		run(task, { type: "queries", subject: { pair, need, researcher }, input: { sector: need.sector, problem: pair.problem.text, searchTerms: need.searchTerms } })
		return task
	}

	/**
	 * Search with the model's queries and the need's own terms, then hand the calls to the model to pick from.
	 * The pick task exists before the search starts, so the run never looks idle while the portal answers.
	 */
	async function search({ pair, need, researcher }: Subject, queries: string[]): Promise<void> {
		const task = createTask("scout", agent, pair.id)
		const terms = [...queries.slice(0, MAX_QUERIES), ...need.searchTerms.slice(0, 4)]
		const found = await calls.search(terms, need.sector)
		const list = found.calls.slice(0, MAX_CALLS)
		const base: Omit<FundingMatch, "calls"> = {
			pairId: pair.id,
			challengeId: pair.challengeId,
			companyId: pair.companyId,
			researcherId: pair.researcherId,
			queries: found.queries,
			considered: list.length,
			...(found.error ? { error: found.error } : {}),
		}
		emit(agent.getId(), "funding.searched", { taskId: task.id, pairId: pair.id, queries: found.queries, calls: list.length, error: found.error })
		if (!list.length) {
			post({ ...base, calls: [], noneReason: found.error ? "The EU portal did not answer." : "The EU portal has no open or upcoming call for these queries." })
			failTask(task, found.error ?? "no open or upcoming EU call found")
			return
		}
		run(task, { type: "pick", base, input: scoutInput(pair, need, researcher, list), calls: list })
	}

	function completed(taskId: string): void {
		const job = jobs.get(taskId)
		const task = state().tasks.get(taskId)
		if (!job || !task) return
		jobs.delete(taskId)
		try {
			if (job.type === "queries") void search(job.subject, queryList(parseJson<{ queries: string[] }>(task.output).queries))
			else post({ ...job.base, taskId, ...fits(parseJson<FundingAnswer>(task.output), job.calls) })
		} catch (error) {
			retryOrFail(task, job, error instanceof Error ? error.message : String(error))
		}
	}

	function retryOrFail(task: Task, job: Job, error: string): void {
		if (task.attempts < state().budget.maxAttempts) {
			emit(agent.getId(), "task.retry", { taskId: task.id, error })
			run(task, job, `\n\nYour previous answer could not be used (${error}). Answer again with valid JSON for the schema.`)
			return
		}
		// The tracker marked the task done on the model's answer. Reopen it so failTask settles it.
		task.status = "running"
		failTask(task, error)
	}

	function post(match: FundingMatch): void {
		state().funding.set(match.pairId, match)
		emit(agent.getId(), "funding.posted", {
			taskId: match.taskId,
			pairId: match.pairId,
			calls: match.calls.map((fit) => fit.call.id),
			none: match.noneReason,
		})
	}

	return { agent, calls, scout, results: () => [...state().funding.values()] }
}

/** The model's queries, trimmed, without repeats, at most 4. A list with none is no answer. */
export function queryList(queries: unknown): string[] {
	if (!Array.isArray(queries)) throw new Error("queries is not a list")
	const list = [...new Set(queries.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean))].slice(0, MAX_QUERIES)
	if (!list.length) throw new Error("no query given")
	return list
}

/**
 * The model's picks, checked by code: each call must be one the portal returned for this pair (so its title,
 * deadline and link are the portal's own, never the model's), at most once, and at most 3.
 */
export function fits(answer: FundingAnswer, calls: FundingCall[]): Pick<FundingMatch, "calls" | "noneReason"> {
	if (!answer || !Array.isArray(answer.calls)) throw new Error("calls is not a list")
	const byId = new Map(calls.map((call) => [call.id, call]))
	const picked: FundingFit[] = []
	for (const { callId, reason, check } of answer.calls) {
		const id = callId?.trim().startsWith("CALL:") ? callId.trim() : `CALL:${callId?.trim()}`
		const call = byId.get(id)
		if (!call || !reason?.trim() || picked.some((fit) => fit.call.id === id)) continue
		picked.push({ call, reason: reason.trim(), ...(check?.trim() ? { check: check.trim() } : {}) })
		if (picked.length === MAX_FITS) break
	}
	if (picked.length) return { calls: picked }
	if (answer.calls.length) throw new Error(`none of the picked calls is in the list: ${answer.calls.map((c) => c.callId).join(", ")}`)
	return { calls: [], noneReason: answer.noneReason?.trim() || "No call in the list covers this problem." }
}
