import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"
import { isUndiciSocketAssertion } from "../src/runtime/crash"

// Run: npx tsx --test test/crash.test.ts

const SCRIPT = fileURLToPath(new URL("./fixtures/undici-crash.ts", import.meta.url))

function run(mode: string) {
	const child = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, mode], { encoding: "utf8", timeout: 60_000 })
	const lines = child.stdout.trim().split("\n").filter(Boolean)
	return { code: child.status, stderr: child.stderr, lines: lines.map((line) => JSON.parse(line) as Record<string, unknown>) }
}

describe("undici socket assertion", () => {
	test("is told apart from other assertions", () => {
		const undici = Object.assign(new Error("false == true"), {
			code: "ERR_ASSERTION",
			stack: "AssertionError [ERR_ASSERTION]: false == true\n    at Parser.finish (node:internal/deps/undici/undici:6157:9)",
		})
		assert.equal(isUndiciSocketAssertion(undici), true)
		assert.equal(isUndiciSocketAssertion(Object.assign(new Error("x"), { code: "ERR_ASSERTION" })), false)
		assert.equal(isUndiciSocketAssertion(new Error("undici")), false)
		assert.equal(isUndiciSocketAssertion("ERR_ASSERTION undici"), false)
	})

	test("stops a process with no guard", () => {
		const { code, stderr } = run("bare")
		assert.notEqual(code, 0)
		assert.match(stderr, /ERR_ASSERTION/)
		assert.match(stderr, /undici/)
	})

	test("under the guard, the hit requests fail on their timeout and the process goes on", () => {
		const { code, lines } = run("guarded")
		assert.equal(code, 0)
		const [results] = lines as Array<{ read: number; timedOut: number; other: number }>
		assert.ok(results.timedOut > 0, "the repro no longer triggers the assertion")
		assert.ok(results.read > 0)
		assert.equal(results.other, 0)
		assert.equal(lines.length, 1, "nothing was saved")
	})
})

describe("guardRun", () => {
	test("saves the partial results on any other uncaught error, then exits 1", () => {
		const { code, lines } = run("crash")
		assert.equal(code, 1)
		assert.deepEqual(lines, [{ saved: "uncaught error: boom" }])
	})

	test("saves the partial results on SIGTERM, then exits 143", () => {
		const { code, lines } = run("sigterm")
		assert.equal(code, 143)
		assert.deepEqual(lines, [{ saved: "terminated (SIGTERM)" }])
	})
})
