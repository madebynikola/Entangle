/**
 * What the Stage says about a task that failed: a run limit stopped it, or it failed and will be tried again.
 *
 *   npx tsx --tsconfig web/tsconfig.json --test test/stage-words.test.ts
 */
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { Line } from "../web/src/screens/stage/derive"
import { groupLog, limitOf, sayMany, verbOf } from "../web/src/screens/stage/words"

const names = { company: new Map(), researcher: new Map() }
const fail = (n: number, error?: string): Line => ({ key: `${n}`, ms: n, from: "fides", to: ["deneb"], act: "fail", kind: "task.failed", id: `critique-${n}`, error })

describe("stage words for failed tasks", () => {
	test("reads the limit from the runtime's error text", () => {
		assert.equal(limitOf("wall clock >= 3600000 ms"), "time")
		assert.equal(limitOf("timeout: wall clock"), "time")
		assert.equal(limitOf("tokens 5000 >= 4000"), "token")
		assert.equal(limitOf("cost $5.10 >= $5.00"), "cost")
		assert.equal(limitOf("never started"), null)
		assert.equal(limitOf(undefined), null)
	})

	test("a task stopped by a limit is not tried again", () => {
		const line = fail(1, "wall clock >= 3600000 ms")
		assert.equal(sayMany([line], names), "critique-1 stopped at the time limit.")
		assert.equal(verbOf(line), "stopped")
	})

	test("a task that failed for another reason keeps its words", () => {
		const line = fail(1, "never started")
		assert.equal(sayMany([line], names), "critique-1 failed. Trying again.")
		assert.equal(verbOf(line), "failed")
	})

	test("a burst stopped by one limit is one line", () => {
		const lines = Array.from({ length: 19 }, (_, i) => fail(i, i % 2 ? "timeout: wall clock" : "wall clock >= 3600000 ms"))
		const groups = groupLog(lines)
		assert.equal(groups.length, 1)
		assert.equal(sayMany(groups[0], names), "Time limit reached. 19 open tasks stopped.")
	})

	test("a different failure breaks the burst", () => {
		const groups = groupLog([fail(1, "timeout: wall clock"), fail(2, "never started"), fail(3, "timeout: wall clock")])
		assert.equal(groups.length, 3)
	})
})
