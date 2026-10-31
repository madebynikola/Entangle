import { fileURLToPath } from "node:url"
import { FormData, fetch as undiciFetch } from "undici"
import type { FundingCall, SourceRecord, SourceStore } from "../types"
import { Bm25 } from "./bm25"

export type { FundingCall }

/**
 * Open and upcoming EU funding calls from the Funding & Tenders portal's search API (docs/brief/apis.md, "EU calls").
 * The key `SEDIA` is public. Search by a need's research terms only: calls are not people, so no name ever goes out.
 * The search returns closed calls and FAQ pages too, so this keeps only calls with a deadline still ahead.
 */

export interface CallSearch {
	/** The search strings sent, one per call. */
	queries: string[]
	/** Calls with a deadline ahead, the best match first, no repeats. */
	calls: FundingCall[]
	/** Why a request failed. The calls found before it are kept. */
	error?: string
}

export interface EuCallsOptions {
	/** Results per query before the deadline filter. Default 50. */
	pageSize?: number
	/** Requests at once, over every search of the run. Default 4: the portal asks for gentle use. */
	concurrency?: number
	timeoutMs?: number
	/** "Today" for the deadline filter. Tests pass a fixed date. */
	now?: () => Date
	/** Default: fetch from npm undici, not Node's own (see portalFetch). Tests pass a stub. */
	fetch?: typeof fetch
}

/**
 * The portal answers with `Connection: close` and bodies of about 530 KB. When the run reads a body late, Node 22's
 * bundled undici (6.x) pauses its parser, and the socket's close then fails `assert(!this.paused)` in Parser.finish,
 * an uncaught error that stops the process (out/2026-10-31T15-04-02/repro-portal.mjs). Undici 8.6 fixes it.
 * The form must be undici's FormData too: undici 8 sends Node's global one as the text "[object FormData]", and the
 * portal then ignores the filters and answers with closed calls and FAQ pages only.
 */
export const portalFetch = undiciFetch as unknown as typeof fetch

export interface EuCalls {
	/** Open and upcoming calls: one query per term, plus the broad area (the company's sector). Cached per terms; never throws. */
	search(searchTerms: string[], area?: string): Promise<CallSearch>
	/** Every call found so far, as a citable source. */
	calls: SourceStore
}

/** Real calls saved from the portal on 30 Oct 2026, for mock runs and tests. */
export const SAVED_CALLS = fileURLToPath(new URL("../../test/fixtures/eu-calls.json", import.meta.url))

const API = "https://api.tech.ec.europa.eu/search-api/prod/rest/search"
const PORTAL = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/"
/** Serbia's Innovation Fund has no API; a proposal links to its calls page. */
export const INNOVATION_FUND_URL = "https://www.inovacionifond.rs"

/** Portal `type`: 1 a call topic, 2 and 8 a cascade open call. Leaves out tenders and FAQ pages. */
const CALL_TYPES = ["1", "2", "8"]
/** Portal `status`: 31094501 forthcoming, 31094502 open (31094503 is closed). */
const STATUS: Record<string, FundingCall["status"]> = { "31094501": "forthcoming", "31094502": "open" }

const PROGRAMMES: Array<[RegExp, string]> = [
	[/^HORIZON-MSCA/, "Horizon Europe (MSCA)"],
	[/^HORIZON-EIC/, "Horizon Europe (EIC)"],
	[/^HORIZON-JU/, "Horizon Europe (Joint Undertaking)"],
	[/^HORIZON/, "Horizon Europe"],
	[/^ERC/, "European Research Council"],
	[/^DIGITAL/, "Digital Europe"],
	[/^LIFE/, "LIFE"],
	[/^CEF/, "Connecting Europe Facility"],
	[/^EU4H/, "EU4Health"],
	[/^InnovFund/i, "Innovation Fund (EU)"],
	[/^I3/, "Interregional Innovation Investments"],
	[/^EDF/, "European Defence Fund"],
	[/^SMP/, "Single Market Programme"],
	[/^ERASMUS/, "Erasmus+"],
	[/^CERV/, "Citizens, Equality, Rights and Values"],
]

/** Call ids look like `CALL:HORIZON-CL4-2027-05-DIGITAL-EMERGING-03`. */
export const isCallId = (id: string) => id.startsWith("CALL:")

export function createEuCalls(options: EuCallsOptions = {}): EuCalls {
	const { pageSize = 50, timeoutMs = 8000, concurrency = 4 } = options
	const get = options.fetch ?? portalFetch
	const now = options.now ?? (() => new Date())
	const found = new Map<string, SourceRecord>()
	const cache = new Map<string, Promise<CallSearch>>()
	let running = 0
	const waiting: Array<() => void> = []

	/** Run `job` when a request slot is free. */
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

	async function query(text: string): Promise<FundingCall[]> {
		const params = new URLSearchParams({ apiKey: "SEDIA", text, pageSize: String(pageSize), pageNumber: "1" })
		const form = new FormData()
		const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" })
		form.append("query", json({ bool: { must: [{ terms: { type: CALL_TYPES } }, { terms: { status: Object.keys(STATUS) } }] } }))
		form.append("languages", json(["en"]))
		const response = await get(`${API}?${params}`, { method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs) })
		// An unread body can crash the process when the server then closes the socket (src/runtime/crash.ts): drop it.
		if (!response.ok) {
			await response.body?.cancel().catch(() => {})
			throw new Error(`EU Funding & Tenders answered ${response.status}`)
		}
		const body = (await response.json()) as { results?: RawResult[] }
		const today = now().toISOString().slice(0, 10)
		return (body.results ?? []).map((raw) => toCall(raw, today)).filter((call) => call !== undefined)
	}

	async function lookup(searchTerms: string[], area?: string): Promise<CallSearch> {
		const queries = callQueries(searchTerms, area)
		const settled = await Promise.allSettled(queries.map((text) => slot(() => query(text))))
		const lists = settled.map((result) => (result.status === "fulfilled" ? result.value : []))
		const fused = fuse(lists)
		const calls = interleave(rerank(fused, [area ?? "", ...searchTerms].join(" ")), fused)
		for (const call of calls) found.set(call.id, callRecord(call))
		const failed = settled.find((result) => result.status === "rejected")
		return failed ? { queries, calls, error: errorText(failed.reason) } : { queries, calls }
	}

	return {
		search(searchTerms, area) {
			const key = [area ?? "", ...searchTerms].join("\n")
			if (!cache.has(key)) cache.set(key, lookup(searchTerms, area))
			return cache.get(key)!
		},
		calls: { get: (id) => found.get(id), has: (id) => found.has(id) },
	}
}

/**
 * A client on saved calls, for mock runs and tests: no network. Each search ranks the saved calls by the words
 * they share with the search terms; with no shared word, the first six, so a mock run always shows the Scout at work.
 * The deadline filter is skipped, so a mock run looks the same on any date.
 */
export function savedEuCalls(saved: FundingCall[]): EuCalls {
	const found = new Map<string, SourceRecord>()
	const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
	return {
		async search(searchTerms) {
			const terms = words(searchTerms.join(" "))
			const score = (call: FundingCall) => [...words(`${call.title} ${call.keywords.join(" ")}`)].filter((w) => terms.has(w)).length
			const calls: FundingCall[] = saved
				.map((call) => ({ call, score: score(call) }))
				.filter(({ score }) => score > 0)
				.sort((a, b) => b.score - a.score)
				.map(({ call }) => call)
			if (!calls.length) calls.push(...saved.slice(0, 6))
			for (const call of calls) found.set(call.id, callRecord(call))
			return { queries: callQueries(searchTerms), calls }
		},
		calls: { get: (id) => found.get(id), has: (id) => found.has(id) },
	}
}

/**
 * One query per term, at most 8 (the Scout's EU-vocabulary queries, then the need's search terms), plus the area.
 * A call that several queries find is likely the closest. Lower case and without the characters the portal's
 * query parser reads.
 */
export function callQueries(terms: string[], area?: string): string[] {
	const clean = (term: string) => term.toLowerCase().replace(/["():|*\\]/g, " ").replace(/\s+/g, " ").trim()
	const queries = terms.map(clean).filter(Boolean).slice(0, 8)
	if (area && clean(area)) queries.push(clean(area))
	return [...new Set(queries)]
}

/** Reciprocal rank fusion of the queries' answers: an item ranked high by several queries comes first. */
export function fuse<T extends { id: string }>(lists: T[][]): T[] {
	const scores = new Map<string, { item: T; score: number }>()
	for (const list of lists) {
		list.forEach((item, rank) => {
			const entry = scores.get(item.id) ?? { item, score: 0 }
			entry.score += 1 / (RRF_K + rank)
			scores.set(item.id, entry)
		})
	}
	return [...scores.values()].sort((a, b) => b.score - a.score).map(({ item }) => item)
}

/**
 * The portal ranks by the whole topic text, so broad calls ("specialised education", "soil health") come back for
 * almost any query. Rank the calls again with BM25 on their title (twice) and keywords against the need's area and
 * search terms; calls with no shared word keep the portal's order behind the rest. Neither order is good alone
 * (BM25 rewards a common word like "industrial"), so the search interleaves both and the Scout's model judges.
 */
export function rerank(calls: FundingCall[], query: string): FundingCall[] {
	const index = new Bm25<number>()
	calls.forEach((call, i) => index.add(i, `${call.title} ${call.title} ${call.keywords.join(" ")}`))
	const scores = new Map(index.search(query, calls.length).map((hit) => [hit.doc, hit.score]))
	return calls
		.map((call, i) => ({ call, i, score: scores.get(i) ?? 0 }))
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.map(({ call }) => call)
}

/** Two rankings of the same items, taken in turns, each item once. */
export function interleave<T extends { id: string }>(a: T[], b: T[]): T[] {
	const out = new Map<string, T>()
	for (let i = 0; i < Math.max(a.length, b.length); i++) for (const item of [a[i], b[i]]) if (item && !out.has(item.id)) out.set(item.id, item)
	return [...out.values()]
}

/** The usual constant for reciprocal rank fusion: the first few ranks of a list count, the long tail hardly. */
const RRF_K = 10

/** A call as a source record. It links no dataset researcher or company. */
export function callRecord(call: FundingCall): SourceRecord {
	const facts = [
		call.programme,
		call.action,
		call.openCallBy && `open call of the EU project ${call.openCallBy}`,
		`${call.status === "open" ? "open" : `opens ${call.opens ?? "soon"}`}, deadline ${call.deadline}`,
		grantText(call.grant),
		call.keywords.length ? `keywords: ${call.keywords.join("; ")}` : undefined,
	]
	return {
		id: call.id,
		kind: "call",
		title: call.title,
		text: facts.filter(Boolean).join(". ") + ".",
		researcherIds: [],
		year: Number(call.deadline.slice(0, 4)),
		url: call.url,
	}
}

/** "EU grant €3,000,000–5,000,000 per project, about 6 grants". */
export function grantText(grant: FundingCall["grant"]): string | undefined {
	if (!grant || (!grant.min && !grant.max)) return undefined
	const euro = (n: number) => `€${n.toLocaleString("en")}`
	const range = grant.min && grant.max && grant.min !== grant.max ? `${euro(grant.min)}–${euro(grant.max)}` : euro((grant.max ?? grant.min)!)
	return `EU grant ${range} per project${grant.expected ? `, about ${grant.expected} grant${grant.expected === 1 ? "" : "s"}` : ""}`
}

interface RawResult {
	summary?: string
	url?: string
	metadata?: Record<string, string[] | undefined>
}

/** One portal result as a call, or undefined when it is not a call or its deadlines have passed. */
export function toCall(raw: RawResult, today: string): FundingCall | undefined {
	const m = raw.metadata ?? {}
	const first = (key: string) => m[key]?.[0]?.trim() || undefined
	const identifier = first("identifier")
	const status = STATUS[first("status") ?? ""]
	const type = first("type")
	if (!identifier || !status || !type || !CALL_TYPES.includes(type)) return undefined
	const deadline = (m.deadlineDate ?? []).map((date) => date.slice(0, 10)).filter((date) => date >= today).sort()[0]
	if (!deadline) return undefined
	const title = (first("title") ?? raw.summary ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
	if (!title) return undefined
	const cascade = type !== "1"
	const opens = first("startDate")?.slice(0, 10)
	return {
		id: `CALL:${identifier}`,
		identifier,
		title,
		programme: PROGRAMMES.find(([prefix]) => prefix.test(identifier))?.[1] ?? "EU programme",
		call: cascade ? first("callTitle") : first("callIdentifier"),
		action: first("typesOfAction")?.replace(/\s+/g, " ").replace(/^[A-Z0-9]+ (?=[A-Z])/, ""),
		openCallBy: cascade ? first("projectAcronym") : undefined,
		status,
		deadline,
		opens: status === "forthcoming" && opens && opens > today ? opens : undefined,
		// A cascade call gives only its whole budget, not an amount per project.
		grant: cascade ? undefined : topicGrant(first("budgetOverview")),
		keywords: (m.keywords ?? []).map((k) => k.trim()).filter((k) => k && !k.startsWith(identifier.split("-")[0])).slice(0, 8),
		url: cascade ? (first("url") ?? raw.url ?? `${PORTAL}${identifier}`) : `${PORTAL}${identifier}`,
	}
}

function topicGrant(overview: string | undefined): FundingCall["grant"] {
	if (!overview) return undefined
	try {
		const parsed = JSON.parse(overview) as { budgetTopicActionMap?: Record<string, Array<{ minContribution?: number; maxContribution?: number; expectedGrants?: number }>> }
		const action = Object.values(parsed.budgetTopicActionMap ?? {}).flat()[0]
		if (!action) return undefined
		return { min: action.minContribution || undefined, max: action.maxContribution || undefined, expected: action.expectedGrants || undefined }
	} catch {
		return undefined
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
