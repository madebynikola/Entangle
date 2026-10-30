import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { CLAIM_LABELS, formatScore, reviewLabels, scoreCritic, type CriticLabels, type ReviewedClaim } from "../src/agents/critic"
import { MockInferenceRunner, startRuntime } from "../src/runtime"

// Run: npx tsx --test test/critic-score.test.ts

const labels = JSON.parse(readFileSync(new URL("fixtures/critic-labels.json", import.meta.url), "utf8")) as CriticLabels
const claims = labels.proposals.flatMap((proposal) => proposal.claims.map((claim) => ({ ...claim, phase: proposal.phase })))
const count = (phase: string, ...wanted: string[]) => claims.filter((c) => c.phase === phase && wanted.includes(c.label)).length

describe("the labelled claims", () => {
	test("hold the hand-check of docs/quality.md: 76 claims before, 53 after, 15 and 8 of them wrong", () => {
		assert.equal(count("before", ...CLAIM_LABELS), 76)
		assert.equal(count("after", ...CLAIM_LABELS), 53)
		assert.equal(count("before", "judgement", "uncited-detail", "widened"), 15)
		assert.equal(count("after", "judgement", "uncited-detail", "widened"), 8)
		assert.equal(count("before", "borderline"), 6)
	})

	test("every label is known, and every wrong or borderline claim says why", () => {
		for (const claim of claims) {
			assert.ok(CLAIM_LABELS.includes(claim.label), claim.label)
			if (claim.label !== "ok") assert.ok(claim.note, `${claim.text} has no note`)
		}
	})

	test("every cited record and every pair's researcher, company and challenge is in the file", () => {
		for (const proposal of labels.proposals) {
			const [challengeId, researcherId] = proposal.pairId.split(":")
			const ids = [challengeId, challengeId.split("-")[0], researcherId, ...proposal.claims.flatMap((claim) => claim.sourceIds)]
			for (const id of ids) assert.equal(labels.records[id]?.id, id, `${proposal.id} cites ${id}`)
		}
	})
})

describe("scoreCritic", () => {
	const reviewed = (label: ReviewedClaim["label"], rejectedBy: string[] = []): ReviewedClaim => ({
		n: 1,
		text: `${label} ${rejectedBy.join(",")}`,
		sourceIds: ["R0001"],
		label,
		proposalId: "P1",
		phase: "after",
		rejectedBy,
	})
	const review = [
		reviewed("judgement", ["critic"]),
		reviewed("uncited-detail", ["critic-2"]),
		reviewed("widened"),
		reviewed("ok"),
		reviewed("ok", ["critic-2"]),
		reviewed("borderline", ["critic"]),
	]

	test("recall on wrong claims, false rejects on ok ones, borderline in neither", () => {
		const score = scoreCritic(review)
		assert.equal(score.bad, 3)
		assert.equal(score.caught, 2)
		assert.equal(score.recall, 2 / 3)
		assert.equal(score.good, 2)
		assert.equal(score.falseRejects, 1)
		assert.equal(score.falseRejectRate, 0.5)
		assert.deepEqual(score.byLabel.borderline, { claims: 1, rejected: 1 })
		assert.deepEqual(score.missed.map((c) => c.label), ["widened"])
		assert.deepEqual(score.falselyRejected.map((c) => c.text), ["ok critic-2"])
	})

	test("with a reviewer, only its rejections count", () => {
		const score = scoreCritic(review, "critic")
		assert.equal(score.caught, 1)
		assert.equal(score.falseRejects, 0)
		assert.deepEqual(score.byLabel.judgement, { claims: 1, rejected: 1 })
		assert.deepEqual(score.byLabel["uncited-detail"], { claims: 1, rejected: 0 })
	})

	test("the report gives both rates and a row per label", () => {
		const text = formatScore(scoreCritic(review), "Mock:")
		assert.match(text, /Caught 2 of 3 wrong claims \(recall 67%\)/)
		assert.match(text, /Rejected 1 of 2 ok claims \(false rejects 50%\)/)
		for (const label of CLAIM_LABELS) assert.match(text, new RegExp(`^  ${label} `, "m"))
	})
})

describe("reviewLabels on the mock Critic", () => {
	test("reviews every labelled claim with both reviewers, also of two proposals with one id", async () => {
		startRuntime({ runId: "critic-score-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [5, 20] }) })
		const review = await reviewLabels(labels, { model: "claude-sonnet-4-6", secondModel: "claude-haiku-4-5" })
		assert.equal(review.claims.length, claims.length)
		assert.deepEqual(review.reviewers.map((r) => r.name), ["critic", "critic-2"])
		for (const claim of review.claims) {
			for (const by of claim.rejectedBy) assert.ok(["critic", "critic-2", "code"].includes(by), by)
		}
		for (const phase of ["before", "after"]) {
			const rejected = review.claims.filter((c) => c.proposalId === "C012-CH1-R0564" && c.phase === phase && c.rejectedBy.length)
			assert.ok(rejected.length > 0, `C012-CH1-R0564 from the ${phase} run was reviewed`)
		}
	})
})
