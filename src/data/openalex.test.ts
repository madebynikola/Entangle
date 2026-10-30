/**
 * OpenAlex client tests, on a stubbed fetch: no network.
 *
 *   node --import tsx --test src/data/openalex.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { SourceStore } from "../types"
import { abstractText, clipAbstract, createOpenAlex, withWorks, workQueries } from "./openalex"

const raw = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
	id: `https://openalex.org/${id}`,
	display_name: title,
	publication_year: 2022,
	cited_by_count: 30,
	primary_location: { source: { display_name: "Biomedical Signal Processing and Control" } },
	abstract_inverted_index: { Lossless: [0], ECG: [1], compression: [2], "works.": [3] },
	...extra,
})

function stub(pages: unknown[][], status = 200) {
	const urls: URL[] = []
	const fetch = (async (input: string | URL | Request) => {
		urls.push(new URL(String(input)))
		const results = pages[urls.length - 1] ?? []
		return new Response(JSON.stringify({ results }), { status })
	}) as typeof globalThis.fetch
	return { fetch, urls }
}

describe("openalex", () => {
	it("rebuilds an abstract from its inverted index", () => {
		assert.equal(abstractText({ world: [1], Hello: [0], again: [3], "hello,": [2] }), "Hello world hello, again")
		assert.equal(abstractText(null), "")
	})

	it("cuts a long abstract after a whole sentence, never between a figure and its scope", () => {
		// W4293154696: a cut at 900 chars left "6.52, 3." and dropped "for 547 PTBDB ECG records".
		const text = "It was tested on Physionet. An average CR of 6.52, 3.82 and 2.49 was achieved for 547 PTBDB records, respectively. More."
		assert.equal(clipAbstract(text, 60), "It was tested on Physionet. …")
		assert.equal(clipAbstract(text, 200), text)
		assert.equal(clipAbstract("No sentence end here at all", 10), "No sentenc…")
	})

	it("sends two search terms per query, lower case, without operator characters", () => {
		assert.deepEqual(workQueries(["ECG Signal Compression", 'lossless "coding"', "Quasi-periodic: signals", "biomedical OR coding", "fifth"]), [
			"ecg signal compression lossless coding",
			"quasi-periodic signals biomedical or coding",
		])
		assert.deepEqual(workQueries(["one"]), ["one"])
		assert.deepEqual(workQueries([]), [])
	})

	it("finds works by topic, filters recent cited ones, and keeps no authors", async () => {
		const { fetch, urls } = stub([[raw("W1", "Lossless ECG compression", { authorships: [{ author: { display_name: "A Person" } }] })], [raw("W2", "Quasi-periodic coding")]])
		const openalex = createOpenAlex({ apiKey: "k", fetch })
		const result = await openalex.priorWork(["ecg compression", "lossless", "quasi-periodic", "coding"])
		assert.deepEqual(result.queries, ["ecg compression lossless", "quasi-periodic coding"])
		assert.deepEqual(result.works.map((work) => work.id), ["W1", "W2"])
		assert.equal(result.error, undefined)
		const [first] = urls
		assert.equal(first.searchParams.get("search"), "ecg compression lossless")
		assert.match(first.searchParams.get("filter")!, /from_publication_date:\d{4}-01-01,type:article\|review,has_abstract:true,is_retracted:false,cited_by_count:>4/)
		assert.ok(!first.searchParams.get("select")!.includes("authorships"))
		assert.equal(first.searchParams.get("api_key"), "k")
		const record = openalex.works.get("W1")!
		assert.equal(record.kind, "work")
		assert.equal(record.text, "Biomedical Signal Processing and Control, 2022. Lossless ECG compression works.")
		assert.deepEqual(record.researcherIds, [])
		assert.equal(record.url, "https://openalex.org/W1")
		assert.ok(!JSON.stringify(record).includes("A Person"))
	})

	it("drops duplicate titles and works without an abstract", async () => {
		const { fetch } = stub([[raw("W1", "Same paper"), raw("W2", "same paper"), raw("W3", "No abstract", { abstract_inverted_index: null })]])
		const result = await createOpenAlex({ fetch }).priorWork(["a", "b"])
		assert.deepEqual(result.works.map((work) => work.id), ["W1"])
	})

	it("asks once per set of terms", async () => {
		const { fetch, urls } = stub([[raw("W1", "One")]])
		const openalex = createOpenAlex({ fetch })
		await Promise.all([openalex.priorWork(["a", "b"]), openalex.priorWork(["a", "b"])])
		assert.equal(urls.length, 1)
	})

	it("reports a failed call without the key and keeps what it found", async () => {
		let calls = 0
		const fetch = (async () => {
			calls++
			return calls === 1 ? new Response(JSON.stringify({ results: [raw("W1", "One")] })) : new Response("busy", { status: 429 })
		}) as typeof globalThis.fetch
		const result = await createOpenAlex({ apiKey: "secret", fetch }).priorWork(["a", "b", "c", "d"])
		assert.deepEqual(result.works.map((work) => work.id), ["W1"])
		assert.equal(result.error, "OpenAlex answered 429")
	})

	it("adds the works found to the dataset's sources, by work id only", async () => {
		const dataset: SourceStore = {
			get: (id) => (id === "R0001" ? { id, kind: "researcher", title: "R", text: "", researcherIds: [id] } : undefined),
			has: (id) => id === "R0001",
		}
		const openalex = createOpenAlex({ fetch: stub([[raw("W1", "One")]]).fetch })
		await openalex.priorWork(["a"])
		const sources = withWorks(dataset, openalex.works)
		assert.ok(sources.has("R0001") && sources.has("W1"))
		assert.ok(!sources.has("W2") && !sources.has("SYN-PUB-00001"))
		assert.equal(sources.get("W1")?.kind, "work")
	})
})
