import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { applyClaimFixes, assignFixes, numbered, type ClaimFix } from "../src/agents/matchmaker/shared"
import type { Claim, RejectedClaim } from "../src/types"

// Run: npx tsx --test test/claim-fixes.test.ts

const claim = (text: string, ...sourceIds: string[]): Claim => ({ text, sourceIds })
const reject = (c: Claim): RejectedClaim => ({ claim: c, reason: "not in the source", check: "unsupported" })
const rewrite = (index: number, text: string): ClaimFix => ({ index, action: "rewrite", text, sourceIds: ["SYN-PUB-00001"] })

const wavelet = claim("Knežević co-authored work on wavelet compression of signals on embedded platforms, directly applicable to radio payload.", "SYN-PUB-00001")
const bench = claim("The benchmarking record covers STM32, RISC-V and ARM Cortex-M families.", "SYN-PUB-00002")
const problem = claim("Using the company's hardware, Knežević would apply duty-cycling to the patch radio, targeting a verified 35% cut.", "C005-CH1")
const rejected = [wavelet, bench, problem].map(reject)

describe("which rejected claim a fix is for", () => {
	test("fixes that give the right index keep it", () => {
		const fixes = [rewrite(0, "Knežević co-authored work on wavelet compression of signals on embedded platforms."), rewrite(2, "Knežević would apply duty-cycling to the patch radio.")]
		const assigned = assignFixes(rejected, fixes)
		assert.deepEqual([...assigned.keys()].sort(), [0, 2])
		assert.equal(assigned.get(0), fixes[0])
	})

	test("fixes counted from 1 go to the claims they rewrite, not the next ones", () => {
		const fixes = [
			rewrite(1, "Knežević co-authored work on wavelet compression of signals on embedded platforms."),
			rewrite(2, "The benchmarking record covers STM32H7, GD32VF1 and RP2040."),
			rewrite(3, "Knežević would apply duty-cycling to the patch radio, aiming at the company's 35% target."),
		]
		const assigned = assignFixes(rejected, fixes)
		assert.equal(assigned.get(0), fixes[0])
		assert.equal(assigned.get(1), fixes[1])
		assert.equal(assigned.get(2), fixes[2])
	})

	test("fixes that give the claim's place in the artifact are matched by their words", () => {
		// The run of 30 Oct: 4 rejected claims, fixes for indexes 0, 3, 4 and 6.
		const fixes = [rewrite(4, "Knežević would apply duty-cycling to the patch radio."), rewrite(6, "The benchmarking record covers STM32H7 and RP2040.")]
		const assigned = assignFixes(rejected, fixes)
		assert.equal(assigned.get(2), fixes[0])
		assert.equal(assigned.get(1), fixes[1])
		assert.equal(assigned.has(0), false, "no fix for it: it is dropped")
	})

	test("a rewrite in range that reads like no rejected claim stays at its index", () => {
		const fixes = [rewrite(1, "The cited records cover vibration sensors only.")]
		assert.equal(assignFixes(rejected, fixes).get(1), fixes[0])
	})

	test("applied to the artifact: the problem claim is rewritten, not lost", () => {
		const problems = [problem]
		const why = [wavelet, bench]
		applyClaimFixes([problems, why], rejected, [rewrite(4, "Knežević would apply duty-cycling to the patch radio.")])
		assert.deepEqual(problems.map((c) => c.text), ["Knežević would apply duty-cycling to the patch radio."])
		assert.deepEqual(why, [], "the claims with no fix are dropped")
	})

	test("the fix prompt shows each rejected claim with its index", () => {
		assert.deepEqual(numbered(rejected).map((r) => [r.index, r.claim.text]), rejected.map((r, i) => [i, r.claim.text]))
	})
})
