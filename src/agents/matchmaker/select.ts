import type { CompanyNeed, PairCandidate, ResearcherProfile } from "../../types"

/** Shortlist and selection for the Matchmaker. No model calls. */

const STOP = new Set(["and", "the", "for", "with", "from", "into", "using", "based", "of", "on", "in", "to", "a", "an", "systems", "system", "data", "method", "methods"])

/** Lowercase word stems, with Cyrillic and diacritics folded so `Марковић` and `Markovic` meet. */
export function words(text: string): Set<string> {
	const folded = text.toLowerCase().replace(/[Ѐ-ӿ]/g, (c) => CYRILLIC[c] ?? c).normalize("NFD").replace(/\p{M}/gu, "")
	// A 6-letter prefix is a crude stem: "lemmatizer" meets "lemmatization", "scripts" meets "script".
	return new Set(folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 6)))
}

const CYRILLIC: Record<string, string> = Object.fromEntries(
	"а:a б:b в:v г:g д:d ђ:dj е:e ж:z з:z и:i ј:j к:k л:l љ:lj м:m н:n њ:nj о:o п:p р:r с:s т:t ћ:c у:u ф:f х:h ц:c ч:c џ:dz ш:s"
		.split(" ")
		.map((pair) => pair.split(":")),
)

/**
 * How many of the need's search terms a profile's evidence covers (a term counts once, at most 1),
 * so a long publication list adds nothing by itself.
 */
export function termCoverage(need: CompanyNeed, profile: ResearcherProfile): number {
	const evidence = words([...profile.expertise, ...profile.industryFit].map((claim) => claim.text).join(" "))
	let score = 0
	for (const term of need.searchTerms) {
		const terms = [...words(term)]
		if (terms.length) score += terms.filter((w) => evidence.has(w)).length / terms.length
	}
	return score
}

/** Candidates for one challenge from profiles on the blackboard, by search-term coverage. A list for this problem, not a ranking of people. */
export function shortlist(need: CompanyNeed, profiles: ResearcherProfile[], size = 6): ResearcherProfile[] {
	return profiles
		.map((profile) => ({ profile, score: termCoverage(need, profile) }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, size)
		.map(({ profile }) => profile)
}

export interface ChooseOptions {
	/** Most pairs in all. Default: no limit. */
	max?: number
	/** Most pairs per challenge. Default 1. */
	perChallenge?: number
	/** Most pairs per researcher. Default 1. */
	perResearcher?: number
	/** Most pairs per company. Default 1. */
	perCompany?: number
	/** Pairs under this fit are not written up. Default 0.5. */
	minFit?: number
}

/**
 * Pick the pairs to write up, with variety: few pairs per researcher and per company.
 * Fit is compared only within a challenge. Challenges take turns in the order given (default:
 * the order pairs landed), so one challenge's high numbers never push out another challenge.
 */
export function choosePairs(candidates: Iterable<PairCandidate>, options: ChooseOptions = {}, challengeOrder?: string[]): PairCandidate[] {
	const { max = Infinity, perChallenge = 1, perResearcher = 1, perCompany = 1, minFit = 0.5 } = options
	const byChallenge = new Map<string, PairCandidate[]>()
	for (const id of challengeOrder ?? []) byChallenge.set(id, [])
	for (const pair of candidates) {
		if (pair.fit < minFit) continue
		const list = byChallenge.get(pair.challengeId) ?? []
		list.push(pair)
		byChallenge.set(pair.challengeId, list)
	}
	for (const list of byChallenge.values()) list.sort((a, b) => b.fit - a.fit)

	const chosen: PairCandidate[] = []
	const count = (key: string, map: Map<string, number>) => map.get(key) ?? 0
	const perR = new Map<string, number>()
	const perC = new Map<string, number>()
	const perCh = new Map<string, number>()
	for (let round = 0; round < perChallenge; round++) {
		for (const [challengeId, list] of byChallenge) {
			if (chosen.length >= max) return chosen
			if (count(challengeId, perCh) > round) continue
			const pick = list.find(
				(pair) => !chosen.includes(pair) && count(pair.researcherId, perR) < perResearcher && count(pair.companyId, perC) < perCompany,
			)
			if (!pick) continue
			chosen.push(pick)
			perR.set(pick.researcherId, count(pick.researcherId, perR) + 1)
			perC.set(pick.companyId, count(pick.companyId, perC) + 1)
			perCh.set(challengeId, count(challengeId, perCh) + 1)
		}
	}
	return chosen
}
