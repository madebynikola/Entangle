import type { Dataset } from "./dataset"

export interface Shard {
	/** 0-based. */
	index: number
	ids: string[]
	/** Estimated tokens to read the shard (chars / 4). */
	tokens: number
	/** For researcher shards: the `faculty / department` groups in it. */
	groups?: string[]
}

/**
 * Split companies into `n` contiguous id ranges of near-equal token size (profile + challenges + pages).
 * Pass `ids` to shard a subset, e.g. the first N companies of a run.
 */
export function shardCompanies(data: Dataset, n: number, ids: string[] = [...data.companies.keys()]): Shard[] {
	const sorted = [...ids].sort()
	const sizes = sorted.map((id) => companyTokens(data, id))
	const total = sizes.reduce((a, b) => a + b, 0)
	const count = Math.max(1, Math.min(n, sorted.length))
	const shards: Shard[] = Array.from({ length: count }, (_, index) => ({ index, ids: [], tokens: 0 }))
	let shard = 0
	let done = 0
	sorted.forEach((id, i) => {
		// Move on when this shard has its share and every later shard can still get at least one company.
		const left = sorted.length - i
		if (shard < count - 1 && shards[shard].ids.length && (done >= (total * (shard + 1)) / count || left <= count - 1 - shard)) shard++
		shards[shard].ids.push(id)
		shards[shard].tokens += sizes[i]
		done += sizes[i]
	})
	return shards
}

/**
 * Split researchers into `n` shards of near-equal token size, keeping each department together
 * (docs/dataset.md: faculties are far too uneven; a worker that stays in a few departments reads their vocabulary consistently).
 * Greedy: largest department first, into the lightest shard. Pass `ids` to shard a shortlist.
 */
export function shardResearchers(data: Dataset, n: number, ids: string[] = [...data.researchers.keys()]): Shard[] {
	const groups = new Map<string, { ids: string[]; tokens: number }>()
	for (const id of ids) {
		const r = data.researcher(id)
		if (!r) continue
		const key = `${r.faculty} / ${r.department}`
		let group = groups.get(key)
		if (!group) groups.set(key, (group = { ids: [], tokens: 0 }))
		if (!group.ids.includes(r.id)) {
			group.ids.push(r.id)
			group.tokens += researcherTokens(data, r.id)
		}
	}
	const count = Math.max(1, Math.min(n, groups.size))
	const shards: Required<Shard>[] = Array.from({ length: count }, (_, index) => ({ index, ids: [], tokens: 0, groups: [] }))
	for (const [key, group] of [...groups.entries()].sort((a, b) => b[1].tokens - a[1].tokens)) {
		const lightest = shards.reduce((a, b) => (b.tokens < a.tokens ? b : a))
		lightest.ids.push(...group.ids)
		lightest.tokens += group.tokens
		lightest.groups.push(key)
	}
	for (const shard of shards) shard.ids.sort()
	return shards
}

/** Tokens to read a researcher's bundle: profile plus own publications, projects and patents. */
export function researcherTokens(data: Dataset, id: string): number {
	const r = data.researcher(id)
	if (!r) return 0
	let chars = JSON.stringify(r).length
	for (const p of r.publications) chars += JSON.stringify(data.publications.get(p)).length
	for (const p of r.projects) chars += JSON.stringify(data.projects.get(p)).length
	for (const p of r.patents) chars += JSON.stringify(data.patents.get(p)).length
	return Math.ceil(chars / 4)
}

/** Tokens to read a company's bundle: profile, challenges and pages. */
export function companyTokens(data: Dataset, id: string): number {
	const c = data.companies.get(id)
	if (!c) return 0
	let chars = JSON.stringify(c).length
	for (const ch of c.challenges) chars += JSON.stringify(data.challenges.get(ch)).length
	for (const p of c.pages) chars += JSON.stringify(data.pages.get(p)).length
	return Math.ceil(chars / 4)
}
