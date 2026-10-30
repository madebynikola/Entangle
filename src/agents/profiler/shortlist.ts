import { findResearchersForNeed, type Dataset, type Researcher } from "../../data"
import type { CompanyNeed } from "../../types"

/** Who gets profiled for a need: retrieval on the Analyst's research vocabulary. No model calls. */

export interface Shortlist {
	challengeId: string
	/** Candidates for this problem, strongest evidence first. Not a ranking of people. */
	researcherIds: string[]
	/** Retrieved above the cut but left out, with the reason. */
	skipped: Array<{ researcherId: string; reason: string }>
	/** Why the need gets no candidates at all, e.g. it is not a research problem. */
	reason?: string
}

export interface ShortlistOptions {
	/** Candidates per need. Default 8. */
	k?: number
	/** Researcher ids to leave out. */
	exclude?: string[]
}

/**
 * The query for a need: the search terms (research vocabulary) twice, then the restatement.
 * Never the raw challenge text: the 26 Serbian companies and the business wording match poorly on it.
 */
export function retrievalText(need: CompanyNeed): string {
	const terms = need.searchTerms.join(", ")
	return terms ? `${terms}. ${terms}. ${need.restatement.text}` : need.restatement.text
}

/** The top `k` researchers whose records fit the need, without those who cannot take part at all. */
export function shortlistFor(data: Dataset, need: CompanyNeed, options: ShortlistOptions = {}): Shortlist {
	const { challengeId } = need
	const k = options.k ?? 8
	if (need.triage === "not-research") {
		return { challengeId, researcherIds: [], skipped: [], reason: `not a research problem: ${need.triageReason}` }
	}
	const researcherIds: string[] = []
	const skipped: Shortlist["skipped"] = []
	// Twice k, so the cut still has k after the skips.
	for (const match of findResearchersForNeed(data, retrievalText(need), k * 2, { exclude: options.exclude })) {
		if (researcherIds.length >= k) break
		const reason = unavailable(data.researcher(match.researcherId)!)
		if (reason) skipped.push({ researcherId: match.researcherId, reason })
		else researcherIds.push(match.researcherId)
	}
	return researcherIds.length
		? { challengeId, researcherIds, skipped }
		: { challengeId, researcherIds, skipped, reason: "no researcher's records match the search terms" }
}

/**
 * Why a researcher cannot take part at all, or null. Emeritus researchers who still consult stay in:
 * their profile says they cannot lead (`canLead`), and the Matchmaker puts that in the pair's risks.
 */
export function unavailable(r: Researcher): string | null {
	if (r.status === "departed") return "has left the university"
	if (r.status === "emeritus" && !/consult|advis/i.test(`${r.availability ?? ""} ${r.openTo.join(" ")}`)) return "retired, not available"
	return null
}
