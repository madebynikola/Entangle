import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { RunRegistry } from "../src/server/runs"

// Run: npx tsx --test test/run-stopped.test.ts

function runFolder(summary?: Record<string, unknown>): RunRegistry {
	const out = mkdtempSync(join(tmpdir(), "stopped-"))
	const dir = join(out, "2026-10-31T10-00-00")
	mkdirSync(dir)
	writeFileSync(join(dir, "trace.jsonl"), JSON.stringify({ t: "2026-10-31T10:00:00.000Z", ms: 0 }) + "\n")
	if (summary) writeFileSync(join(dir, "summary.json"), JSON.stringify({ runId: "r", mock: false, budget: { tokensUsed: 0, costUsd: 0, startedAt: 0 }, ...summary }))
	return new RunRegistry(out)
}

describe("RunInfo.stopped", () => {
	test("carries the reason a stopped run wrote in summary.json", () => {
		const info = runFolder({ stopped: "uncaught error: boom" }).info("2026-10-31T10-00-00")
		assert.equal(info?.status, "ended")
		assert.equal(info?.stopped, "uncaught error: boom")
	})

	test("is absent on a full run and on a run with no summary", () => {
		assert.equal("stopped" in (runFolder({}).info("2026-10-31T10-00-00") ?? {}), false)
		assert.equal("stopped" in (runFolder().info("2026-10-31T10-00-00") ?? {}), false)
	})
})
