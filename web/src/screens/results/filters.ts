import { useMemo } from "react"
import { useSearchParams } from "react-router"
import { byDatasetId, companyOf, type Company, type ResultsIndex } from "./data"

/** The pairs explorer's filters. They live in the URL, so a filtered view can be shared and survives a reload. */
export interface PairFilters {
	sector: string
	faculty: string
	challenge: string
	researcher: string
}

const KEYS: (keyof PairFilters)[] = ["sector", "faculty", "challenge", "researcher"]

export function useFilters() {
	const [params, setParams] = useSearchParams()
	const filters = useMemo(() => Object.fromEntries(KEYS.map((key) => [key, params.get(key) ?? ""])) as unknown as PairFilters, [params])
	const set = (patch: Partial<PairFilters>) =>
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev)
				for (const [key, value] of Object.entries(patch)) {
					if (value) next.set(key, value)
					else next.delete(key)
				}
				return next
			},
			{ replace: true },
		)
	const active = KEYS.some((key) => filters[key])
	return { filters, set, active, search: params.toString() ? `?${params.toString()}` : "" }
}

export interface Visible {
	/** Challenges to list, in dataset order. */
	challenges: string[]
	pairs: Set<string>
	researchers: Set<string>
	/** Visible pairs over all pairs. */
	shown: number
	total: number
}

/**
 * Which challenges, pairs and researchers pass the filters. Sector and challenge filter the company side;
 * faculty and researcher filter the researcher side. With a researcher-side filter, a challenge shows only
 * if one of its pairs passes, so "no good match" challenges hide.
 */
export function applyFilters(index: ResultsIndex, filters: PairFilters): Visible {
	const researcherSide = Boolean(filters.faculty || filters.researcher)
	const pairs = new Set<string>()
	const researchers = new Set<string>()
	const challenges: string[] = []
	for (const challengeId of index.challengeIds) {
		const company = companyOf(index, challengeId.split("-")[0])
		if (filters.sector && company.sector !== filters.sector) continue
		if (filters.challenge && challengeId !== filters.challenge) continue
		let any = false
		for (const pair of index.pairsByChallenge.get(challengeId) ?? []) {
			if (filters.faculty && index.profiles.get(pair.researcherId)?.faculty !== filters.faculty) continue
			if (filters.researcher && pair.researcherId !== filters.researcher) continue
			pairs.add(pair.id)
			researchers.add(pair.researcherId)
			any = true
		}
		if (any || !researcherSide) challenges.push(challengeId)
	}
	return { challenges, pairs, researchers, shown: pairs.size, total: index.pairs.size }
}

/** Choices for the filter menus: only values that occur among the run's pairs and challenges. */
export function filterOptions(index: ResultsIndex) {
	const sectors = new Set<string>()
	const companies = new Map<string, { company: Company; challenges: string[] }>()
	for (const challengeId of index.challengeIds) {
		const company = companyOf(index, challengeId.split("-")[0])
		if (company.sector) sectors.add(company.sector)
		const group = companies.get(company.id) ?? { company, challenges: [] }
		group.challenges.push(challengeId)
		companies.set(company.id, group)
	}
	const faculties = new Set<string>()
	for (const pair of index.pairs.values()) {
		const faculty = index.profiles.get(pair.researcherId)?.faculty
		if (faculty) faculties.add(faculty)
	}
	return {
		sectors: [...sectors].sort(),
		faculties: [...faculties].sort(),
		companies: [...companies.values()].sort((a, b) => byDatasetId(a.company.id, b.company.id)),
	}
}
