import type { SourceId } from "../types"
import type { CompanyDoc, Dataset, ResearchDoc } from "./dataset"
import type { ResearcherStatus } from "./normalize"
import { analyze } from "./text"

export interface PublicationHit {
	id: string
	title: string
	year: number
	type: string
	/** Canonical ids of the dataset researchers among the authors. Only these links count. */
	researchers: Array<{ id: string; name: string }>
	keywords: string[]
	/** The abstract sentence that best matches the query. */
	snippet: string
	/** Relevance to this query only. Not comparable across queries. */
	relevance: number
	sourceIds: SourceId[]
}

export interface Evidence {
	id: string
	kind: ResearchDoc["kind"]
	title: string
	year?: number
	snippet: string
}

/** A researcher whose records match a need. A candidate for this problem, not a ranking of people. */
export interface ResearcherMatch {
	researcherId: string
	name: string
	title: string
	faculty: string
	department: string
	status: ResearcherStatus
	canLead: boolean
	/** True when their notes limit availability; read `get_researcher` for the dates. */
	limitedAvailability: boolean
	/** 0..1, relative to the best match for this text. Fit of the records to the need, never a measure of the person. */
	relevance: number
	/** The best-matching records, best first. */
	evidence: Evidence[]
	sourceIds: SourceId[]
}

export interface CompanyHit {
	id: string
	kind: CompanyDoc["kind"]
	companyId: string
	companyName: string
	title: string
	snippet: string
	relevance: number
	sourceIds: SourceId[]
}

export function searchPublications(data: Dataset, query: string, k = 10): PublicationHit[] {
	const hits = data.researchIndex.search(query, k, (doc) => doc.kind === "publication")
	return hits.map(({ doc, score }) => {
		const p = data.publications.get(doc.id)!
		return {
			id: p.id,
			title: p.title,
			year: p.year,
			type: p.type,
			researchers: p.researcherIds.map((id) => ({ id, name: data.researchers.get(id)!.name })),
			keywords: p.keywords,
			snippet: bestSentence(p.abstract, query),
			relevance: round(score),
			sourceIds: [p.id, ...p.researcherIds],
		}
	})
}

export interface FindOptions {
	/** Researcher ids to leave out, e.g. ones already shortlisted. */
	exclude?: string[]
	/** Leave out emeritus and departed researchers. Default false: they may still consult. */
	activeOnly?: boolean
	/** Evidence records per researcher. Default 3. */
	evidence?: number
}

/**
 * Researchers whose publications, projects, patents and profile match a need, best first.
 * Per researcher the score is the mean of their top 3 record scores (missing ones count 0),
 * so many weak papers do not outrank a few strong ones, and output volume is not a score.
 */
export function findResearchersForNeed(data: Dataset, text: string, k = 10, options: FindOptions = {}): ResearcherMatch[] {
	const exclude = new Set((options.exclude ?? []).map((id) => data.canonicalId(id)))
	const perResearcher = new Map<string, Array<{ doc: ResearchDoc; score: number }>>()
	for (const hit of data.researchIndex.search(text, 1500)) {
		for (const id of hit.doc.researcherIds) {
			if (exclude.has(id)) continue
			let list = perResearcher.get(id)
			if (!list) perResearcher.set(id, (list = []))
			list.push(hit)
		}
	}

	const ranked = [...perResearcher.entries()]
		.map(([id, hits]) => ({ researcher: data.researchers.get(id)!, hits, score: (hits[0].score + (hits[1]?.score ?? 0) + (hits[2]?.score ?? 0)) / 3 }))
		.filter(({ researcher }) => !options.activeOnly || researcher.canLead)
		.sort((a, b) => b.score - a.score)
		.slice(0, k)
	const best = ranked[0]?.score ?? 1

	return ranked.map(({ researcher: r, hits, score }) => {
		const evidence = hits.slice(0, options.evidence ?? 3).map(({ doc }) => evidenceOf(data, doc, text))
		return {
			researcherId: r.id,
			name: r.name,
			title: r.title,
			faculty: r.faculty,
			department: r.department,
			status: r.status,
			canLead: r.canLead,
			limitedAvailability: r.availability !== null,
			relevance: round(score / best),
			evidence,
			sourceIds: [r.id, ...evidence.map((e) => e.id).filter((id) => id !== r.id)],
		}
	})
}

/** Challenges, job ads and company profiles that match a text: the reverse search, researcher → companies. */
export function searchCompanies(data: Dataset, query: string, k = 10): CompanyHit[] {
	return data.companyIndex.search(query, k).map(({ doc, score }) => {
		const company = data.companies.get(doc.companyId)!
		const source = data.source(doc.id)!
		const body = doc.kind === "challenge" ? data.challenges.get(doc.id)!.detail : source.text
		return {
			id: doc.id,
			kind: doc.kind,
			companyId: company.id,
			companyName: company.name,
			title: doc.kind === "company" ? `${company.name} (${company.sector})` : source.title,
			snippet: bestSentence(body, query),
			relevance: round(score),
			sourceIds: doc.kind === "company" ? [company.id] : [doc.id, company.id],
		}
	})
}

function evidenceOf(data: Dataset, doc: ResearchDoc, query: string): Evidence {
	switch (doc.kind) {
		case "publication": {
			const p = data.publications.get(doc.id)!
			return { id: p.id, kind: doc.kind, title: p.title, year: p.year, snippet: bestSentence(p.abstract || p.keywords.join(", "), query) }
		}
		case "project": {
			const p = data.projects.get(doc.id)!
			return { id: p.id, kind: doc.kind, title: `${p.acronym ? `${p.acronym}: ` : ""}${p.title}`, year: Number(p.years.slice(0, 4)) || undefined, snippet: bestSentence(p.summary, query) }
		}
		case "patent": {
			const p = data.patents.get(doc.id)!
			return { id: p.id, kind: doc.kind, title: p.title, year: p.year, snippet: bestSentence(p.abstract, query) }
		}
		case "researcher": {
			const r = data.researchers.get(doc.id)!
			const text = [r.keywords.join(", "), r.bio, r.openTo.join(". "), r.industryExperience].join(". ")
			return { id: r.id, kind: doc.kind, title: `Profile of ${r.name}`, snippet: bestSentence(text, query) }
		}
	}
}

/** The sentence with the most distinct query terms; the first sentence when none match. Max ~300 chars. */
export function bestSentence(text: string, query: string, max = 300): string {
	if (!text) return ""
	const terms = new Set(analyze(query))
	const sentences = text.split(/(?<=[.!?;])\s+/)
	let best = sentences[0]
	let bestScore = 0
	for (const sentence of sentences) {
		const score = new Set(analyze(sentence).filter((t) => terms.has(t))).size
		if (score > bestScore) {
			best = sentence
			bestScore = score
		}
	}
	return best.length > max ? `${best.slice(0, max - 1)}…` : best
}

function round(n: number): number {
	return Math.round(n * 1000) / 1000
}
