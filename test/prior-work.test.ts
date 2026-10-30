import assert from "node:assert/strict"
import { before, describe, test } from "node:test"
import type { InferenceInput } from "@mozaik-ai/core"
import { createCritic, type Critic } from "../src/agents/critic"
import { checkByCode } from "../src/agents/critic/checks"
import { createWriter, type Writer } from "../src/agents/writer"
import { createOpenAlex, withWorks, type OpenAlex } from "../src/data/openalex"
import { MockInferenceRunner, join, lastUserText, startRuntime, state, whenSettled } from "../src/runtime"
import { TRUE_CLAIMS, need, pair, profile, proposal, store } from "./critic-fixtures"

// Run: npx tsx --test test/prior-work.test.ts

/** OpenAlex on a stubbed fetch: one real-looking work for any query, no network. */
function stubOpenAlex(): OpenAlex {
	const work = {
		id: "https://openalex.org/W4293154696",
		display_name: "Formal verification of packet filter firmware in Coq",
		publication_year: 2022,
		cited_by_count: 30,
		primary_location: { source: { display_name: "Journal of Automated Reasoning" } },
		abstract_inverted_index: { We: [0], verify: [1], packet: [2], filter: [3], firmware: [4], in: [5], "Coq.": [6] },
	}
	const fetch = (async () => new Response(JSON.stringify({ results: [work] }))) as typeof globalThis.fetch
	return createOpenAlex({ fetch })
}

describe("prior work in a proposal", () => {
	const reviews: string[] = []
	let critic: Critic
	let writer: Writer
	let openAlex: OpenAlex

	before(() => {
		// Stands in for the model on both checks: every claim is supported, and the free text is fine.
		const reviewer = (input: InferenceInput) => {
			const schema = input.structuredOutput?.name
			if (schema === "critic_review") {
				const message = lastUserText(input)
				reviews.push(message)
				const claims = message.match(/^\d+\. /gm) ?? []
				return JSON.stringify({ checks: claims.map((_, i) => ({ claim: i + 1, reason: "Stated.", supported: true })) })
			}
			if (schema === "critic_text_review") return JSON.stringify({ statements: [] })
			return undefined
		}
		startRuntime({ runId: "prior-work-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [5, 15], responders: [reviewer] }) })
		openAlex = stubOpenAlex()
		const sources = withWorks(store, openAlex.works)
		critic = createCritic({ store: sources, model: "claude-sonnet-4-6", dualReview: [] })
		join(critic.agent)
		writer = createWriter({ name: "writer-prior-work", sources, priorWork: (n) => openAlex.priorWork(n.searchTerms) })
		const s = state()
		s.needs.set("C001-CH1", need())
		s.profiles.set("R0001", profile([TRUE_CLAIMS.coq]))
		s.candidates.set("C001-CH1:R0001", pair([TRUE_CLAIMS.coq, TRUE_CLAIMS.firmware]))
	})

	test("the Writer gets the works, cites one under Prior work, and the Critic reads it as a work", async () => {
		writer.write("C001-CH1:R0001")
		await settle(critic)

		const id = "C001-CH1-R0001"
		const written = state().proposals.get(id)!
		assert.equal(critic.status("proposal", id), "accepted")
		assert.match(written.markdown, /### The problem[\s\S]*### Prior work\n- A 2022 study reports: .+ \[W4293154696\]\n\n### Research questions/)
		assert.match(written.markdown, /- W4293154696: Formal verification of packet filter firmware in Coq \(2022\) https:\/\/openalex\.org\/W4293154696/)
		assert.deepEqual(written.claims[3].sourceIds, ["W4293154696"], "after the two header claims and the problem")

		const review = reviews.find((message) => message.includes(id))!
		assert.match(review, /\[W4293154696\] work · Formal verification of packet filter firmware in Coq · 2022\nJournal of Automated Reasoning, 2022\. We verify/)
		const writes = [...state().tasks.values()].filter((task) => task.kind === "write" && task.subjectId === id)
		assert.equal(writes.length, 1)
	})

	test("a work id OpenAlex did not return is rejected by code, in a claim and in free text", () => {
		const sources = withWorks(store, openAlex.works)
		const invented = { text: "A 2023 study solved this.", sourceIds: ["W1111111111"] }
		const real = { text: "A 2022 study verifies packet filter firmware in Coq.", sourceIds: ["W4293154696"] }
		const check = checkByCode("proposal", proposal([real, invented], "Builds on W2222222222 and W4293154696."), state(), sources)
		assert.deepEqual(check.passed, [real])
		assert.deepEqual(
			check.rejected.map((r) => [r.check, r.claim.sourceIds.join()]),
			[
				["unknown-source", "W1111111111"],
				["unknown-source", "W2222222222"],
			],
		)
	})
})

async function settle(critic: Critic): Promise<void> {
	for (;;) {
		await critic.idle()
		// The write task waits, queued, for OpenAlex before it runs.
		await new Promise((resolve) => setTimeout(resolve, 20))
		const open = [...state().tasks.values()].filter((task) => task.status === "running" || task.status === "queued")
		if (!open.length) return
		await whenSettled(open.map((task) => task.id), 30_000)
	}
}
