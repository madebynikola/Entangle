import { readFileSync } from "node:fs"
import { createAgent, type Agent } from "@mozaik-ai/core"
import { createCordis, savedCordis, SAVED_PROJECTS, type Cordis, type ProjectSearch } from "../../data/cordis"
import { createEuCalls, savedEuCalls, SAVED_CALLS, type CallSearch, type EuCalls } from "../../data/eucalls"
import { budgetSpent, createTask, failTask, join, modelFor, runTask, state } from "../../runtime"
import type { CompanyNeed, EuProject, FundingCall, FundingFit, FundingMatch, PairCandidate, ProjectFit, ResearcherProfile, Task } from "../../types"
import { EventOfType, emit, parseJson, registerMockResponder } from "../matchmaker/shared"
import { scoutResponder } from "./mock"
import { FUNDING_SCHEMA, QUERIES_SCHEMA, SCOUT_INSTRUCTION, queriesMessage, scoutInput, scoutMessage, type FundingAnswer, type QueriesInput, type ScoutInput } from "./prompt"

export interface ScoutOptions {
	/** Default: the live portal, or the saved calls in a mock run (no network). */
	calls?: EuCalls
	/** Default: CORDIS, or the saved projects in a mock run. */
	cordis?: Cordis
	/** Default: the role's model from config/models.ts. */
	model?: string
	name?: string
}

export interface Scout {
	agent: Agent
	/** The portal client, so the run can save each call it cites. */
	calls: EuCalls
	cordis: Cordis
	/** Start on a chosen pair: write the queries, search the portal, pick the calls. Returns the first task, or null. */
	scout(pairId: string): Task | null
	/** Every pair's answer so far. */
	results(): FundingMatch[]
}

/** Calls the Scout reads per pair: the portal's best matches with a deadline ahead. */
const MAX_CALLS = 24
/** CORDIS projects the Scout reads per pair. */
const MAX_PROJECTS = 12
const MAX_FITS = 3
const MAX_QUERIES = 4

interface Subject {
	pair: PairCandidate
	need: CompanyNeed
	researcher: ResearcherProfile
}

type Job =
	| { type: "queries"; subject: Subject; input: QueriesInput }
	| { type: "pick"; base: Omit<FundingMatch, "calls">; input: ScoutInput; calls: FundingCall[]; projects: EuProject[] }

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
	const saved = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T
	const calls = options.calls ?? (state().mock ? savedEuCalls(saved<FundingCall[]>(SAVED_CALLS)) : createEuCalls())
	const cordis = options.cordis ?? (state().mock ? savedCordis(saved<EuProject[]>(SAVED_PROJECTS)) : createCordis())
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
	 * Search with the model's queries, the need's own terms and the English area, then hand the calls to the model to pick from.
	 * The pick task exists before the search starts, so the run never looks idle while the portal answers.
	 */
	async function search({ pair, need, researcher }: Subject, queries: string[], area: string): Promise<void> {
		const task = createTask("scout", agent, pair.id)
		const terms = [...queries.slice(0, MAX_QUERIES), ...need.searchTerms.slice(0, 4)]
		// CORDIS needs every word of a query in a project, so the short EU-vocabulary queries and two search terms.
		const projectTerms = [...queries.slice(0, MAX_QUERIES), ...need.searchTerms.slice(0, 2)]
		// The clients never throw by contract. If one does, its search fails like a portal that did not answer, and the
		// pick task settles: an open task would keep the run waiting.
		const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
		const [found, related] = await Promise.all([
			calls.search(terms, area).catch((error): CallSearch => ({ queries: terms, calls: [], error: message(error) })),
			cordis.search(projectTerms).catch((error): ProjectSearch => ({ queries: projectTerms, projects: [], error: message(error) })),
		])
		const list = found.calls.slice(0, MAX_CALLS)
		const projects = related.projects.slice(0, MAX_PROJECTS)
		const base: Omit<FundingMatch, "calls"> = {
			pairId: pair.id,
			challengeId: pair.challengeId,
			companyId: pair.companyId,
			researcherId: pair.researcherId,
			queries: found.queries,
			considered: list.length,
			...(found.error || related.error ? { error: [found.error, related.error].filter(Boolean).join("; ") } : {}),
		}
		emit(agent.getId(), "funding.searched", { taskId: task.id, pairId: pair.id, queries: found.queries, calls: list.length, projects: projects.length, error: base.error })
		if (!list.length && !projects.length) {
			post({ ...base, calls: [], noneReason: found.error ? "The EU portal did not answer." : "The EU portal has no open or upcoming call for these queries." })
			failTask(task, found.error ?? "no open or upcoming EU call found")
			return
		}
		run(task, { type: "pick", base, input: scoutInput(pair, need, researcher, list, projects), calls: list, projects })
	}

	function completed(taskId: string): void {
		const job = jobs.get(taskId)
		const task = state().tasks.get(taskId)
		if (!job || !task) return
		jobs.delete(taskId)
		try {
			if (job.type === "queries") {
				const answer = parseJson<{ queries: string[]; area?: string }>(task.output)
				void search(job.subject, queryList(answer.queries), areaOf(answer.area, job.subject.need.sector))
			}
			else post({ ...job.base, taskId, ...fits(parseJson<FundingAnswer>(task.output), job.calls, job.projects) })
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
			projects: match.projects?.map((fit) => fit.project.id),
			none: match.noneReason,
		})
	}

	return { agent, calls, cordis, scout, results: () => [...state().funding.values()] }
}

/** The model's queries, trimmed, without repeats, at most 4. A list with none is no answer. */
export function queryList(queries: unknown): string[] {
	if (!Array.isArray(queries)) throw new Error("queries is not a list")
	const list = [...new Set(queries.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean))].slice(0, MAX_QUERIES)
	if (!list.length) throw new Error("no query given")
	return list
}

/**
 * The broad area for the portal search: the model's English name for the sector. The portal reads English only, so a
 * sector the dataset gives in Serbian ("Prerada hrane") must not go out as it is. With no answer, the sector itself.
 */
export function areaOf(area: unknown, sector: string): string {
	const text = typeof area === "string" ? area.replace(/\s+/g, " ").trim() : ""
	return text && text.split(" ").length <= 5 ? text : sector
}

/**
 * The model's picks, checked by code: each call and project must be one the search returned for this pair (so its
 * title, dates and link are the source's own, never the model's), at most once, and at most 3 of each.
 */
export function fits(answer: FundingAnswer, calls: FundingCall[], projects: EuProject[] = []): Pick<FundingMatch, "calls" | "noneReason" | "projects"> {
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
	if (!picked.length && answer.calls.length) throw new Error(`none of the picked calls is in the list: ${answer.calls.map((c) => c.callId).join(", ")}`)

	const projectById = new Map(projects.map((project) => [project.id, project]))
	const related: ProjectFit[] = []
	for (const { projectId, reason } of Array.isArray(answer.projects) ? answer.projects : []) {
		const id = projectId?.trim().startsWith("CORDIS:") ? projectId.trim() : `CORDIS:${projectId?.trim()}`
		const project = projectById.get(id)
		if (!project || !reason?.trim() || related.some((fit) => fit.project.id === id)) continue
		related.push({ project, reason: reason.trim() })
		if (related.length === MAX_FITS) break
	}
	const withProjects = related.length ? { projects: related } : {}
	if (picked.length) return { calls: picked, ...withProjects }
	return { calls: [], noneReason: answer.noneReason?.trim() || "No call in the list covers this problem.", ...withProjects }
}
