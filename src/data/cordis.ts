import { fileURLToPath } from "node:url"
import type { EuProject, SourceRecord, SourceStore } from "../types"
import { Bm25 } from "./bm25"
import { fuse, interleave, portalFetch } from "./eucalls"

export type { EuProject }

/**
 * EU-funded projects from CORDIS's search (docs/brief/apis.md, "CORDIS"), found by topic words. No key.
 * A project lists organisations, not people: universities, institutes and companies, so a pair sees who already
 * works on its problem in Europe and who could join a consortium. No person's name is sent or kept.
 */

export interface ProjectSearch {
	/** The search strings sent, one per request. */
	queries: string[]
	/** Projects started since `since`, the best match first, no repeats. */
	projects: EuProject[]
	/** Why a request failed. The projects found before it are kept. */
	error?: string
}

export interface CordisOptions {
	/** Projects per query. Default 10. */
	perQuery?: number
	/** Only projects that started on or after this date. Default 2019-01-01: Horizon 2020's later years and Horizon Europe. */
	since?: string
	/** Requests at once, over every search of the run. Default 3. */
	concurrency?: number
	timeoutMs?: number
	/** Default: fetch from npm undici, not Node's own (see portalFetch in eucalls.ts). Tests pass a stub. */
	fetch?: typeof fetch
}

export interface Cordis {
	/** Projects for these topic terms (one query per term, at most 6). Cached per terms; never throws. */
	search(terms: string[]): Promise<ProjectSearch>
	/** Every project found so far, as a citable source. */
	projects: SourceStore
}

const API = "https://cordis.europa.eu/search"
const SUMMARY_CHARS = 400
/** Projects saved from CORDIS on 30 Oct 2026, for mock runs and tests. */
export const SAVED_PROJECTS = fileURLToPath(new URL("../../test/fixtures/eu-projects.json", import.meta.url))

/** Project ids look like `CORDIS:101225653`. */
export const isProjectId = (id: string) => id.startsWith("CORDIS:")

export function createCordis(options: CordisOptions = {}): Cordis {
	const { perQuery = 10, since = "2019-01-01", concurrency = 3, timeoutMs = 10_000 } = options
	const get = options.fetch ?? portalFetch
	const found = new Map<string, SourceRecord>()
	const cache = new Map<string, Promise<ProjectSearch>>()
	let running = 0
	const waiting: Array<() => void> = []

	async function slot<T>(job: () => Promise<T>): Promise<T> {
		if (running >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve))
		running++
		try {
			return await job()
		} finally {
			running--
			waiting.shift()?.()
		}
	}

	async function query(text: string): Promise<EuProject[]> {
		const q = cordisQuery(text, since)
		if (!q) return []
		const params = new URLSearchParams({ q, p: "1", num: String(perQuery), srt: "Relevance:decreasing", format: "json" })
		const response = await get(`${API}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
		// An unread body can crash the process when the server then closes the socket (src/runtime/crash.ts): drop it.
		if (!response.ok) {
			await response.body?.cancel().catch(() => {})
			throw new Error(`CORDIS answered ${response.status}`)
		}
		const body = (await response.json()) as { hits?: { hit?: RawHit | RawHit[] } | "" }
		const hits = body.hits && typeof body.hits === "object" ? body.hits.hit : undefined
		return (Array.isArray(hits) ? hits : hits ? [hits] : []).map(toProject).filter((project) => project !== undefined)
	}

	async function lookup(terms: string[]): Promise<ProjectSearch> {
		const queries = [...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean))].slice(0, 6)
		const settled = await Promise.allSettled(queries.map((text) => slot(() => query(text))))
		const lists = settled.map((result) => (result.status === "fulfilled" ? result.value : []))
		const fused = fuse(lists)
		const projects = interleave(rerankProjects(fused, terms.join(" ")), fused)
		for (const project of projects) found.set(project.id, projectRecord(project))
		const failed = settled.find((result) => result.status === "rejected")
		return failed ? { queries, projects, error: errorText(failed.reason) } : { queries, projects }
	}

	return {
		search(terms) {
			const key = terms.join("\n")
			if (!cache.has(key)) cache.set(key, lookup(terms))
			return cache.get(key)!
		},
		projects: { get: (id) => found.get(id), has: (id) => found.has(id) },
	}
}

/** A client on saved projects, for mock runs and tests: no network, ranked by shared words. */
export function savedCordis(saved: EuProject[]): Cordis {
	const found = new Map<string, SourceRecord>()
	return {
		async search(terms) {
			const ranked = rerankProjects(saved, terms.join(" "))
			const projects = ranked.length ? ranked : saved.slice(0, 4)
			for (const project of projects) found.set(project.id, projectRecord(project))
			return { queries: terms.slice(0, 6), projects }
		},
		projects: { get: (id) => found.get(id), has: (id) => found.has(id) },
	}
}

/**
 * CORDIS matches a quoted string as an exact phrase, which almost never hits. So each word is its own quoted term,
 * all of them required, plus the start date. Words of 3 letters or more, without quotes or operators.
 */
export function cordisQuery(text: string, since: string): string | undefined {
	const words = text
		.toLowerCase()
		.replace(/['"()]/g, " ")
		.split(/\s+/)
		.filter((word) => word.length >= 3 && !["and", "or", "not", "for", "the", "with"].includes(word))
		.slice(0, 5)
	if (!words.length) return undefined
	return `contenttype='project' AND ${words.map((word) => `'${word}'`).join(" AND ")} AND startDate>='${since}'`
}

/** BM25 on title (twice) and summary. Projects that share no word with the query are left out. */
export function rerankProjects(projects: EuProject[], query: string): EuProject[] {
	const index = new Bm25<number>()
	projects.forEach((p, i) => index.add(i, `${p.title} ${p.title} ${p.summary}`))
	const scores = new Map(index.search(query, projects.length).map((hit) => [hit.doc, hit.score]))
	return projects
		.map((project, i) => ({ project, i, score: scores.get(i) ?? 0 }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map(({ project }) => project)
}

/** A project as a source record. It links no dataset researcher or company. */
export function projectRecord(project: EuProject): SourceRecord {
	const facts = [
		`${project.acronym}, ${project.programme}, ${project.start.slice(0, 4)}–${project.end.slice(0, 4)}`,
		project.topic && `topic ${project.topic}`,
		project.coordinator && `coordinated by ${project.coordinator.name} (${project.coordinator.country})`,
		`${project.organisations} organisation${project.organisations === 1 ? "" : "s"}`,
		project.serbian.length ? `from Serbia: ${project.serbian.join("; ")}` : undefined,
		project.summary,
	]
	return {
		id: project.id,
		kind: "eu-project",
		title: project.title,
		text: facts.filter(Boolean).join(". "),
		researcherIds: [],
		year: Number(project.start.slice(0, 4)) || undefined,
		url: project.url,
	}
}

interface RawOrganisation {
	"@attributes"?: { type?: string }
	legalName?: string
	address?: { country?: string }
}

interface RawHit {
	project?: {
		id?: string
		acronym?: string
		title?: string
		teaser?: string
		objective?: string
		status?: string
		startDate?: string
		endDate?: string
		relations?: {
			associations?: {
				organization?: RawOrganisation | RawOrganisation[]
				programme?: { code?: string; frameworkProgramme?: string; "@attributes"?: { type?: string } } | Array<{ code?: string; frameworkProgramme?: string; "@attributes"?: { type?: string } }>
			}
		}
	}
}

const FRAMEWORKS: Record<string, string> = { HORIZON: "Horizon Europe", H2020: "Horizon 2020" }

export function toProject(hit: RawHit): EuProject | undefined {
	const p = hit.project
	if (!p?.id || !p.title || !p.startDate || !p.endDate) return undefined
	const list = <T>(value: T | T[] | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : [])
	const organisations = list(p.relations?.associations?.organization)
	const programmes = list(p.relations?.associations?.programme)
	const topic = programmes.find((x) => x["@attributes"]?.type === "relatedTopic")?.code
	const framework = programmes.map((x) => x.frameworkProgramme).find(Boolean) ?? (p.id.startsWith("10") ? "HORIZON" : "H2020")
	const coordinator = organisations.find((o) => o["@attributes"]?.type === "coordinator")
	const text = (p.teaser || p.objective || "").replace(/\s+/g, " ").trim()
	return {
		id: `CORDIS:${p.id}`,
		projectId: p.id,
		acronym: p.acronym ?? p.id,
		title: p.title.replace(/\s+/g, " ").trim(),
		summary: text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS).trimEnd()}…` : text,
		status: p.status === "SIGNED" ? "ongoing" : "closed",
		start: p.startDate,
		end: p.endDate,
		programme: FRAMEWORKS[framework] ?? framework,
		topic,
		coordinator: coordinator?.legalName ? { name: coordinator.legalName, country: coordinator.address?.country ?? "" } : undefined,
		organisations: organisations.length,
		serbian: organisations.filter((o) => o.address?.country === "RS" && o.legalName).map((o) => o.legalName!),
		url: `https://cordis.europa.eu/project/id/${p.id}`,
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
