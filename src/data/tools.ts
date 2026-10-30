import type { Tool } from "@mozaik-ai/core"
import { loadDataset, type Dataset } from "./dataset"
import { findResearchersForNeed, searchCompanies, searchPublications } from "./search"

export type DataToolName =
	| "search_publications"
	| "get_researcher"
	| "get_company"
	| "get_source"
	| "find_researchers_for_need"
	| "search_companies"

const MAX_K = 30

/**
 * Mozaik tools over the dataset, for agents. Every result carries `sourceIds` to cite in Claims.
 * Pick a subset by name, e.g. `createDataTools(data, ["get_company", "get_source"])` for the Analyst.
 */
export function createDataTools(data: Dataset = loadDataset(), names?: DataToolName[]): Tool[] {
	const all: Record<DataToolName, Tool> = {
		search_publications: tool(
			"search_publications",
			"BM25 search over the titles, keywords and abstracts of all publications. Use research vocabulary, not business language. " +
				"Returns publications with their linked researchers (by id; only these links count, never match authors by name).",
			{ query: str("Search terms in research vocabulary"), k: int("How many results, 1-30 (default 10)") },
			["query"],
			({ query, k }) => searchPublications(data, String(query), clamp(k)),
		),
		find_researchers_for_need: tool(
			"find_researchers_for_need",
			"Find researchers whose publications, projects, patents and profile fit a company need. Pass an academic restatement " +
				"plus search terms, not raw business text. Returns candidates for this problem with evidence records, " +
				"status (emeritus or departed researchers cannot lead) and an availability flag. Relevance is the fit of the records " +
				"to this need only: never present it as a ranking or score of people.",
			{
				text: str("The need: academic restatement and search terms"),
				k: int("How many researchers, 1-30 (default 10)"),
				exclude: { type: "array", items: { type: "string" }, description: "Researcher ids to leave out" },
			},
			["text"],
			({ text, k, exclude }) => findResearchersForNeed(data, String(text), clamp(k), { exclude: Array.isArray(exclude) ? exclude.map(String) : [] }),
		),
		get_researcher: tool(
			"get_researcher",
			"A researcher's profile by id (R0001): title, faculty, department, fields, keywords, bio, what they are open to, " +
				"industry experience, status, availability, and their publications, projects and patents (ids and titles). " +
				"`notes` are private remarks: use them as constraints, never quote them. Duplicate profiles are merged: an alias id returns the main profile.",
			{ id: str("Researcher id, e.g. R0001"), include_abstracts: { type: "boolean", description: "Add publication abstracts (much longer). Default false" } },
			["id"],
			({ id, include_abstracts }) => researcherView(data, String(id), include_abstracts === true),
		),
		get_company: tool(
			"get_company",
			"A company by id (C001): profile, products, tech, plans, R&D capacity, past collaborations, its challenges (C001-CH1 ...) " +
				"and its pages (website, job ads, news, blog, events; id `C001/<kind>/<date>/<title>`). Email addresses are removed.",
			{ id: str("Company id, e.g. C001") },
			["id"],
			({ id }) => companyView(data, String(id)),
		),
		get_source: tool(
			"get_source",
			"Any record by its dataset id, with the full text to check a claim against: R0001, C001, C001-CH1, SYN-PUB-00001, " +
				"SYN-PRJ-0001, SYN-PAT-001, or a page id `C001/job/2024-02-05/<title>`.",
			{ id: str("Dataset id") },
			["id"],
			({ id }) => {
				const source = data.source(String(id))
				return source ? { ...source, sourceIds: [source.id] } : unknown(String(id))
			},
		),
		search_companies: tool(
			"search_companies",
			"Reverse search: BM25 over company challenges, job ads and company profiles. Use it to find companies whose needs fit a researcher's expertise.",
			{ query: str("Search terms"), k: int("How many results, 1-30 (default 10)") },
			["query"],
			({ query, k }) => searchCompanies(data, String(query), clamp(k)),
		),
	}
	return (names ?? (Object.keys(all) as DataToolName[])).map((name) => all[name])
}

/** What `get_researcher` returns. */
export function researcherView(data: Dataset, id: string, abstracts = false) {
	const r = data.researcher(id.trim())
	if (!r) return unknown(id)
	return {
		id: r.id,
		aliases: r.aliases,
		name: r.name,
		title: r.title,
		faculty: r.faculty,
		department: r.department,
		status: r.status,
		canLead: r.canLead,
		availability: r.availability,
		fields: r.fields,
		keywords: r.keywords,
		bio: r.bio,
		openTo: r.openTo,
		industryExperience: r.industryExperience,
		notes: r.notes,
		publications: r.publications.map((pid) => {
			const p = data.publications.get(pid)!
			return { id: p.id, year: p.year, title: p.title, type: p.type, keywords: p.keywords, ...(abstracts && { abstract: p.abstract }) }
		}),
		projects: r.projects.map((pid) => {
			const p = data.projects.get(pid)!
			const role = p.participants.find((x) => x.researcherId === r.id)?.role
			return { id: p.id, acronym: p.acronym, title: p.title, programme: p.programme, years: p.years, role }
		}),
		patents: r.patents.map((pid) => {
			const p = data.patents.get(pid)!
			return { id: p.id, title: p.title, year: p.year, status: p.status }
		}),
		sourceIds: [r.id],
	}
}

/** What `get_company` returns. */
export function companyView(data: Dataset, id: string) {
	const c = data.companies.get(id.trim())
	if (!c) return unknown(id)
	return {
		...c,
		challenges: c.challenges.map((cid) => data.challenges.get(cid)!),
		pages: c.pages.map((pid) => data.pages.get(pid)!),
		sourceIds: [c.id],
	}
}

function unknown(id: string) {
	return { error: `No record with id "${id}". Ids look like R0001, C001, C001-CH1, SYN-PUB-00001, SYN-PRJ-0001, SYN-PAT-001.` }
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], run: (args: Record<string, unknown>) => unknown): Tool {
	return {
		type: "function",
		name,
		description,
		parameters: { type: "object", properties, required, additionalProperties: false },
		strict: false,
		invoke: async (args: Record<string, unknown>) => run(args ?? {}),
	}
}

function str(description: string) {
	return { type: "string", description }
}

function int(description: string) {
	return { type: "integer", description }
}

function clamp(k: unknown): number {
	const n = Number(k)
	return Number.isFinite(n) && n >= 1 ? Math.min(MAX_K, Math.floor(n)) : 10
}
