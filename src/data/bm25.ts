import { analyze } from "./text"

export interface Hit<D> {
	doc: D
	score: number
}

/** Okapi BM25 over in-memory documents. No dependencies, no API keys. */
export class Bm25<D> {
	private readonly docs: D[] = []
	private readonly lengths: number[] = []
	private readonly postings = new Map<string, { docs: number[]; tfs: number[] }>()
	private totalLength = 0

	constructor(
		private readonly k1 = 1.2,
		private readonly b = 0.75,
	) {}

	get size(): number {
		return this.docs.length
	}

	add(doc: D, text: string): void {
		const index = this.docs.length
		const tokens = analyze(text)
		this.docs.push(doc)
		this.lengths.push(tokens.length)
		this.totalLength += tokens.length
		const tf = new Map<string, number>()
		for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
		for (const [term, count] of tf) {
			let posting = this.postings.get(term)
			if (!posting) this.postings.set(term, (posting = { docs: [], tfs: [] }))
			posting.docs.push(index)
			posting.tfs.push(count)
		}
	}

	/** Top `k` documents for the query, best first. `filter` drops documents before ranking. */
	search(query: string, k: number, filter?: (doc: D) => boolean): Hit<D>[] {
		const terms = [...new Set(analyze(query))]
		const n = this.docs.length
		if (!terms.length || !n) return []
		const avg = this.totalLength / n
		const scores = new Float64Array(n)
		for (const term of terms) {
			const posting = this.postings.get(term)
			if (!posting) continue
			const df = posting.docs.length
			const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
			for (let i = 0; i < df; i++) {
				const d = posting.docs[i]
				const tf = posting.tfs[i]
				scores[d] += (idf * tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + (this.b * this.lengths[d]) / avg))
			}
		}
		const hits: Hit<D>[] = []
		for (let d = 0; d < n; d++) {
			if (scores[d] > 0 && (!filter || filter(this.docs[d]))) hits.push({ doc: this.docs[d], score: scores[d] })
		}
		hits.sort((a, b) => b.score - a.score)
		return hits.slice(0, k)
	}
}
