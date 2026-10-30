import { createAgent, type Agent } from "@mozaik-ai/core"
import type { Dataset } from "../../data"
import {
	SnapRunner,
	createTask,
	innerOf,
	join,
	resolveRuntime,
	runTask,
	screenSettings,
	state,
	whenSettled,
	type Decider,
	type Decision,
	type DecisionQuestion,
	type MockResponder,
	type ScreenSettings,
} from "../../runtime"
import type { CompanyNeed } from "../../types"
import { words } from "../matchmaker/select"
import { jsonBlock, parseJson, registerMockResponder } from "../matchmaker/shared"
import { clip } from "./shared"
import type { Shortlist } from "./shortlist"

/**
 * The shortlist filter: the decision model (subq-snap, Jev) rates a wide shortlist's candidates in one call, with one
 * yes/no question per candidate, and only the most likely are profiled. These models write no text, so the answer
 * is the probability of fit per candidate.
 */

export const SCREEN_INSTRUCTION =
	"You rate how well each researcher on a shortlist fits one company challenge, from the topics of their own records."

const FITS =
	"The researcher's own fields, keywords, papers, projects or patents work on the challenge's core problem or on the " +
	"methods it needs, so they could do research on it with the company."
const NOT_FIT =
	"The records share only broad words with the challenge (data, systems, optimisation, the sector's name), or work on " +
	"another problem or field, so the researcher could not work on its core problem."

/** What the model reads about one candidate: the topics of their records, not the full texts. */
export interface ScreenCandidate {
	id: string
	name: string
	department: string
	fields: string[]
	keywords: string[]
	bio: string
	/** The 10 newest titles. */
	publications: string[]
	projects: string[]
	patents: string[]
}

export interface ScreenInput {
	challenge: { id: string; company: string; sector: string; problem: string; searchTerms: string[]; constraints: string[] }
	researchers: ScreenCandidate[]
}

/** The model's answer: researcher id → probability (0..1) that the researcher fits the challenge. */
export interface ScreenAnswer {
	fit: Record<string, number>
}

export function screenInput(data: Dataset, need: CompanyNeed, researcherIds: string[]): ScreenInput {
	return {
		challenge: {
			id: need.challengeId,
			company: need.companyName,
			sector: need.sector,
			problem: need.restatement.text,
			searchTerms: need.searchTerms,
			constraints: need.constraints.map((claim) => claim.text),
		},
		researchers: researcherIds.map((id) => candidateOf(data, id)),
	}
}

function candidateOf(data: Dataset, id: string): ScreenCandidate {
	const r = data.researcher(id)!
	const publications = r.publications
		.map((pid) => data.publications.get(pid)!)
		.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
		.slice(0, 10)
	return {
		id: r.id,
		name: r.name,
		department: r.department,
		fields: r.fields,
		keywords: r.keywords,
		bio: clip(r.bio, 400),
		publications: publications.map((p) => p.title),
		projects: r.projects.map((pid) => data.projects.get(pid)!.title),
		patents: r.patents.map((pid) => data.patents.get(pid)!.title),
	}
}

/** The input as typed questions for a decision model: one yes/no question per candidate, all against the same input. */
export function screenDecision(input: ScreenInput): Decision {
	const name = (i: number) => `researcher_${i + 1}`
	const questions: Record<string, DecisionQuestion> = {}
	input.researchers.forEach((r, i) => {
		questions[name(i)] = {
			type: "noul",
			instructions: `Could researcher ${r.id} (${r.name}) help solve challenge ${input.challenge.id} with their own research?`,
			criteria: { true: FITS, false: NOT_FIT },
		}
	})
	return {
		state: input,
		questions,
		answer(answers) {
			const fit: Record<string, number> = {}
			input.researchers.forEach((r, i) => {
				const yes = answers[name(i)]?.noul
				if (typeof yes === "number") fit[r.id] = yes
			})
			return JSON.stringify({ fit } satisfies ScreenAnswer)
		},
	}
}

/** The probabilities from a screen task's output, for the listed candidates only. Undefined when none is usable. */
export function readFit(output: string | undefined, researcherIds: string[]): Record<string, number> | undefined {
	let answer: ScreenAnswer
	try {
		answer = parseJson<ScreenAnswer>(output)
	} catch {
		return undefined
	}
	const fit: Record<string, number> = {}
	for (const id of researcherIds) {
		const p = answer?.fit?.[id]
		if (typeof p === "number" && p >= 0 && p <= 1) fit[id] = p
	}
	return Object.keys(fit).length ? fit : undefined
}

/**
 * The shortlist from a wide one and the model's probabilities: the k most likely, at or above the threshold.
 * Ties keep retrieval order. A candidate the model gave no answer for comes after those it rated, and is not cut.
 */
export function cutShortlist(wide: Shortlist, fit: Record<string, number>, k: number, settings: Pick<ScreenSettings, "model" | "threshold">): Shortlist {
	const { model, threshold } = settings
	const rank = (id: string) => fit[id] ?? -1
	const likely = (id: string) => (id in fit ? `${Math.round(fit[id] * 100)}% likely to fit` : "no answer")
	const researcherIds: string[] = []
	const skipped = [...wide.skipped]
	for (const id of [...wide.researcherIds].sort((a, b) => rank(b) - rank(a))) {
		if (id in fit && fit[id] < threshold) skipped.push({ researcherId: id, reason: `${model}: ${likely(id)}, under ${threshold}` })
		else if (researcherIds.length >= k) skipped.push({ researcherId: id, reason: `${model}: ${likely(id)}, below the top ${k}` })
		else researcherIds.push(id)
	}
	const list: Shortlist = { challengeId: wide.challengeId, researcherIds, skipped, fit }
	if (!researcherIds.length) list.reason = `${model} rates no candidate ${Math.round(threshold * 100)}% likely or more to fit`
	return list
}

/** Mock runs: the share of the need's search terms a candidate's record topics cover, so a mock trace shows a cut. */
export function lexicalFit(input: ScreenInput): Record<string, number> {
	const fit: Record<string, number> = {}
	for (const r of input.researchers) {
		const evidence = words([...r.fields, ...r.keywords, ...r.publications, ...r.projects, ...r.patents, r.bio].join(" "))
		let covered = 0
		for (const term of input.challenge.searchTerms) {
			const stems = [...words(term)]
			if (stems.length) covered += stems.filter((w) => evidence.has(w)).length / stems.length
		}
		const terms = input.challenge.searchTerms.length
		fit[r.id] = terms ? Math.round((covered / terms) * 100) / 100 : 0
	}
	return fit
}

export interface Screener {
	agent: Agent
	/**
	 * Rate the wide shortlist's candidates in one call, as a `screen` task, and cut it to k. Resolves with
	 * retrieval's top k when the call fails or gives no usable answer. Never rejects.
	 */
	screen(need: CompanyNeed, wide: Shortlist, k: number): Promise<Shortlist>
}

/**
 * Create the `shortlist-filter` agent and join it. Its calls are tasks like every other model call, so the trace
 * and the budget count them. In a mock run it answers with `lexicalFit`.
 */
export function createScreener(data: Dataset): Screener {
	const jobs = new Map<string, ScreenInput>()
	const agent = createAgent({ name: "shortlist-filter", capabilities: ["inference", "screen"], instruction: SCREEN_INSTRUCTION, tools: [], handlers: [] })
	join(agent)

	const jobOf = (contextId: string) => {
		const taskId = state().contextTasks.get(contextId)
		return taskId ? jobs.get(taskId) : undefined
	}
	const mockResponder: MockResponder = (input) => {
		const job = jobOf(input.context.id)
		return job ? JSON.stringify({ fit: lexicalFit(job) } satisfies ScreenAnswer) : undefined
	}
	const decider: Decider = (input) => {
		const job = jobOf(input.context.id)
		return job ? screenDecision(job) : undefined
	}
	if (state().mock) registerMockResponder(mockResponder)
	innerOf(resolveRuntime().getInferenceRunner(), SnapRunner)?.deciders.push(decider)

	async function screen(need: CompanyNeed, wide: Shortlist, k: number): Promise<Shortlist> {
		if (!wide.researcherIds.length) return wide
		const settings = screenSettings()
		const input = screenInput(data, need, wide.researcherIds)
		const task = createTask("screen", agent, need.challengeId)
		jobs.set(task.id, input)
		runTask(task, jsonBlock(input), { model: settings.model })
		await whenSettled([task.id])
		jobs.delete(task.id)
		const fit = task.status === "done" ? readFit(task.output, wide.researcherIds) : undefined
		return fit ? cutShortlist(wide, fit, k, settings) : { ...wide, researcherIds: wide.researcherIds.slice(0, k) }
	}

	return { agent, screen }
}
