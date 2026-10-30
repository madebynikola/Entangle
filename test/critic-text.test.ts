import assert from "node:assert/strict"
import { before, describe, test } from "node:test"
import type { InferenceInput } from "@mozaik-ai/core"
import { createCritic, type Critic } from "../src/agents/critic"
import { freeTextOf } from "../src/agents/critic/checks"
import { parseTextReview, textReviewMessage } from "../src/agents/critic/prompt"
import { createWriter, replaceFreeText, type ProposalDraft, type Writer } from "../src/agents/writer"
import { MockInferenceRunner, join, lastUserText, startRuntime, state, whenSettled } from "../src/runtime"
import { TRUE_CLAIMS, need, pair, profile, proposal, store } from "./critic-fixtures"

// Run: npx tsx --test test/critic-text.test.ts

function draft(overrides: Partial<ProposalDraft> = {}): ProposalDraft {
	return {
		kind: "joint-project",
		title: "Verified packet filtering",
		problem: [TRUE_CLAIMS.firmware],
		researchQuestions: ["Can the filter be proved correct? Measured by the share of rules with a proof."],
		approach: ["Use the 500 hours of traffic the company already has. Then write the rules down in Coq."],
		plan: [{ period: "Months 1–3", work: "Port the filter rules.", result: "A first proof." }],
		firstSixMonths: ["Move the firmware source.", "Set up the proof project."],
		companyBrings: [TRUE_CLAIMS.testBench],
		researcherBrings: [TRUE_CLAIMS.coq],
		pairReasoning: "The company has the firmware; the researcher has the proofs.",
		whyThisPair: [TRUE_CLAIMS.firmware],
		agreedUpFront: ["Results can be published after a review by the company."],
		...overrides,
	}
}

describe("free text of a proposal (no model)", () => {
	test("a quoted sentence is found despite case, spaces and the end stop, and replaced", () => {
		const d = draft()
		assert.equal(replaceFreeText(d, "use the 500 hours of traffic  the company already has", "Record 500 hours of traffic in month 1."), true)
		assert.deepEqual(d.approach, ["Record 500 hours of traffic in month 1. Then write the rules down in Coq."])
	})

	test("an empty replacement removes the sentence, and a list item left empty goes", () => {
		const d = draft({ firstSixMonths: ["Move the firmware source.", "Set up the proof project."] })
		assert.equal(replaceFreeText(d, "Move the firmware source.", ""), true)
		assert.deepEqual(d.firstSixMonths, ["Set up the proof project."])
		assert.equal(replaceFreeText(d, "A sentence that is not there.", ""), false)
	})

	test("the free text leaves out the claims, so fixing a claim is not a change", () => {
		const markdown = (claim: string) => `## Verified packet filtering\n\n### The problem\n${claim} [C001-CH1]\n\n### Approach\n- Write the rules down in Coq.\n\n### Sources\n- C001-CH1`
		const before = proposal([TRUE_CLAIMS.firmware], markdown(TRUE_CLAIMS.firmware.text))
		const fixed = proposal([{ ...TRUE_CLAIMS.firmware, text: "The company wants proofs." }], markdown("The company wants proofs."))
		assert.equal(freeTextOf(before), freeTextOf(fixed))
		assert.match(freeTextOf(before), /Write the rules down in Coq/)
		assert.doesNotMatch(freeTextOf(before), /Sources|guarantees beyond testing/)
	})

	test("the answer becomes free-text rejects, one per sentence", () => {
		const answer = { statements: [{ quote: " It has an accelerometer. ", reason: "C001 lists no accelerometer." }, { quote: "It has an accelerometer.", reason: "again" }] }
		assert.deepEqual(parseTextReview(JSON.stringify(answer)), [
			{ claim: { text: "It has an accelerometer.", sourceIds: [] }, reason: "C001 lists no accelerometer.", check: "free-text" },
		])
		assert.throws(() => parseTextReview(JSON.stringify({ checks: [] })))
	})

	test("the prompt has the rubric, the proposal and its sources", () => {
		const sources = new Map([["C001-CH1", store.get("C001-CH1")!]])
		const message = textReviewMessage("P-1", { line: "company ArmaturaSec d.o.o. (C001)" }, "### Approach\n- Write the rules down.", sources)
		assert.match(message, /presents as already true a fact/)
		assert.match(message, /### Approach\n- Write the rules down\./)
		assert.match(message, /\[C001-CH1\] challenge · Firmware correctness/)
	})
})

describe("free-text check on the Mozaik runtime", () => {
	/** The sentence the stand-in reviewer finds invented: the Writer's mock puts it in every approach. */
	const INVENTED = "Build a baseline on the company's data and measure it."
	const textReviews: string[] = []
	let critic: Critic
	let writer: Writer

	before(() => {
		// Stands in for the model on the free-text check: it flags INVENTED while the text has it.
		const textReviewer = (input: InferenceInput) => {
			if (input.structuredOutput?.name !== "critic_text_review") return undefined
			const message = lastUserText(input)
			textReviews.push(message)
			const statements = message.includes(INVENTED) ? [{ quote: INVENTED, reason: "No claim says the company has a baseline dataset." }] : []
			return JSON.stringify({ statements })
		}
		startRuntime({ runId: "critic-text-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [10, 30], responders: [textReviewer] }) })
		critic = createCritic({ store, model: "claude-sonnet-4-6", dualReview: [] })
		join(critic.agent)
		writer = createWriter({ name: "writer-text", sources: store })
		const s = state()
		s.needs.set("C001-CH1", need({ sector: "Network security hardware" }))
		s.profiles.set("R0001", profile([TRUE_CLAIMS.coq]))
		s.candidates.set("C001-CH1:R0001", pair([TRUE_CLAIMS.coq, TRUE_CLAIMS.firmware]))
	})

	test("an invented sentence goes back to the Writer, is removed, and the fixed proposal passes", async () => {
		writer.write("C001-CH1:R0001")
		await settle(critic)

		const id = "C001-CH1-R0001"
		const verdicts = state().verdicts.filter((v) => v.proposalId === id)
		assert.deepEqual(verdicts.map((v) => v.action), ["send-back", "accept"])
		assert.deepEqual(verdicts[0].rejected.map((r) => [r.check, r.claim.text]), [["free-text", INVENTED]])
		assert.equal(critic.status("proposal", id), "accepted")

		const markdown = state().proposals.get(id)!.markdown
		assert.doesNotMatch(markdown, /Build a baseline/)
		assert.match(markdown, /Adapt the method to the company's constraints/)

		// One free-text check per version of the free text; the claims passed in the first round.
		assert.equal(textReviews.length, 2)
		const critiques = [...state().tasks.values()].filter((t) => t.kind === "critique" && t.subjectId === id)
		assert.equal(critiques.length, 3, "claims and free text in round one, free text alone in round two")
	})
})

async function settle(critic: Critic): Promise<void> {
	for (;;) {
		await critic.idle()
		const open = [...state().tasks.values()].filter((task) => task.status === "running" || task.status === "queued")
		if (!open.length) return
		await whenSettled(open.map((task) => task.id), 30_000)
	}
}
