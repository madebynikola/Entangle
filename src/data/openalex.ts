import type { SourceRecord, SourceStore } from "../types"

/**
 * Real published work from OpenAlex (api.openalex.org), found by a need's search terms, for a proposal's Prior work.
 * Search by topic only, never by a person's name: the dataset's people are synthetic, and a name search would match
 * real people (docs/dataset.md, rule 8). Authors are never read or kept.
 */

/** One recent, cited OpenAlex work, as the Writer and the Critic see it. */
export interface PriorWork {
	/** OpenAlex work id, e.g. `W4293154696`. */
	id: string
	title: string
	year: number
	venue?: string
	citedBy: number
	/** Rebuilt from OpenAlex's inverted index and clipped. */
	abstract: string
	url: string
}

export interface PriorWorkResult {
	/** The search strings sent, one per call. */
	queries: string[]
	works: PriorWork[]
	/** Why a call failed. The works found before it are kept. */
	error?: string
}

export interface OpenAlexOptions {
	apiKey?: string
	/** Works per query. Default 3. */
	perQuery?: number
	/** Works years back from today. Default 8. */
	years?: number
	timeoutMs?: number
	/** Tests pass a stub. */
	fetch?: typeof fetch
}

export interface OpenAlex {
	/** Recent, cited works on the first four search terms, two terms per query. Cached per terms; never throws. */
	priorWork(searchTerms: string[]): Promise<PriorWorkResult>
	/** Every work found so far, as a citable source. */
	works: SourceStore
}

const API = "https://api.openalex.org/works"
const ABSTRACT_CHARS = 1500

/** Work ids look like `W4293154696`. */
export const isWorkId = (id: string) => /^W\d+$/.test(id)

export function createOpenAlex(options: OpenAlexOptions = {}): OpenAlex {
	const { apiKey, perQuery = 3, years = 8, timeoutMs = 8000 } = options
	const get = options.fetch ?? fetch
	const found = new Map<string, SourceRecord>()
	const cache = new Map<string, Promise<PriorWorkResult>>()
	const since = `${new Date().getFullYear() - years}-01-01`

	async function search(query: string): Promise<PriorWork[]> {
		const params = new URLSearchParams({
			search: query,
			filter: `from_publication_date:${since},type:article|review,has_abstract:true,is_retracted:false,cited_by_count:>4`,
			select: "id,display_name,publication_year,cited_by_count,primary_location,abstract_inverted_index",
			per_page: String(perQuery),
		})
		if (apiKey) params.set("api_key", apiKey)
		// The error names the status only: the URL holds the key.
		const response = await get(`${API}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
		// An unread body can crash the process when the server then closes the socket (src/runtime/crash.ts): drop it.
		if (!response.ok) {
			await response.body?.cancel().catch(() => {})
			throw new Error(`OpenAlex answered ${response.status}`)
		}
		const body = (await response.json()) as { results?: RawWork[] }
		return (body.results ?? []).map(toWork).filter((work) => work !== undefined)
	}

	async function lookup(searchTerms: string[]): Promise<PriorWorkResult> {
		const queries = workQueries(searchTerms)
		const works: PriorWork[] = []
		const titles = new Set<string>()
		for (const query of queries) {
			try {
				for (const work of await search(query)) {
					const title = work.title.toLowerCase()
					if (titles.has(title) || works.some((w) => w.id === work.id)) continue
					titles.add(title)
					works.push(work)
					found.set(work.id, workRecord(work))
				}
			} catch (error) {
				return { queries, works, error: error instanceof Error ? error.message : String(error) }
			}
		}
		return { queries, works }
	}

	return {
		priorWork(searchTerms) {
			const key = searchTerms.join("\n")
			if (!cache.has(key)) cache.set(key, lookup(searchTerms))
			return cache.get(key)!
		},
		works: { get: (id) => found.get(id), has: (id) => found.has(id) },
	}
}

/**
 * Two search terms per query, from the first four: one term alone matches too wide, four at once too narrow.
 * Lower case, so a term never reads as an AND, OR or NOT operator, and without the characters OpenAlex parses.
 */
export function workQueries(searchTerms: string[]): string[] {
	const terms = searchTerms
		.map((term) => term.toLowerCase().replace(/["():|*\\]/g, " ").replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.slice(0, 4)
	const queries: string[] = []
	for (let i = 0; i < terms.length; i += 2) queries.push(terms.slice(i, i + 2).join(" "))
	return queries
}

/** A work as a source record. It links no dataset researcher or company: it is work outside the pair. */
export function workRecord(work: PriorWork): SourceRecord {
	const published = [work.venue, work.year].filter(Boolean).join(", ")
	return {
		id: work.id,
		kind: "work",
		title: work.title,
		text: `${published ? `${published}. ` : ""}${work.abstract}`,
		researcherIds: [],
		year: work.year,
		url: work.url,
	}
}

/** The dataset's sources plus the works OpenAlex returned in this run. */
export function withWorks(dataset: SourceStore, works: SourceStore): SourceStore {
	const store = (id: string) => (isWorkId(id) ? works : dataset)
	return { get: (id) => store(id).get(id), has: (id) => store(id).has(id) }
}

/**
 * An abstract up to `max` chars, cut after a whole sentence. A cut inside a sentence can split a figure from the words
 * that scope it ("6.52, 3.82 and 2.49 for ... records, respectively"), and the Writer and the Critic read the same cut text.
 */
export function clipAbstract(text: string, max = ABSTRACT_CHARS): string {
	if (text.length <= max) return text
	// A sentence ends at . ! or ? before a space and a capital, so "6.52" and "e.g. the" do not end one.
	const ends = [...text.matchAll(/[.!?](?=\s+[A-Z(])/g)].map((match) => match.index + 1).filter((end) => end <= max)
	const end = ends.at(-1)
	return end ? `${text.slice(0, end)} …` : `${text.slice(0, max).trimEnd()}…`
}

/** OpenAlex keeps an abstract as word → positions. */
export function abstractText(index: Record<string, number[]> | null | undefined): string {
	if (!index) return ""
	const words: string[] = []
	for (const [word, positions] of Object.entries(index)) for (const at of positions) words[at] = word
	return words.filter(Boolean).join(" ")
}

interface RawWork {
	id?: string
	display_name?: string | null
	publication_year?: number | null
	cited_by_count?: number
	primary_location?: { source?: { display_name?: string | null } | null } | null
	abstract_inverted_index?: Record<string, number[]> | null
}

function toWork(raw: RawWork): PriorWork | undefined {
	const id = raw.id?.split("/").pop() ?? ""
	const title = raw.display_name?.replace(/<[^>]+>/g, "").trim()
	const abstract = abstractText(raw.abstract_inverted_index).replace(/\s+/g, " ").trim()
	if (!isWorkId(id) || !title || !abstract || !raw.publication_year) return undefined
	return {
		id,
		title,
		year: raw.publication_year,
		venue: raw.primary_location?.source?.display_name ?? undefined,
		citedBy: raw.cited_by_count ?? 0,
		abstract: clipAbstract(abstract),
		url: `https://openalex.org/${id}`,
	}
}
