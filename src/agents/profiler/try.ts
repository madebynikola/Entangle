/**
 * Try the Industry Analysts and the Research Profilers together, with the real Critic and SourceStore.
 *
 *   npx tsx src/agents/profiler/try.ts [--mock] [--full] [--companies N | --ids C006,C054] [--analysts N] [--profilers N] [--k N]
 *
 * Default data: test/fixtures (5 companies, 28 researchers). --full reads data/raw instead (first N companies).
 * With LOCAL_CLAUDE=1 every call is a local `claude -p` session: try a small run first, e.g. `--ids C006,C054 --k 2`.
 * Analysts read every company at once; each need, as it lands, is shortlisted and its candidates profiled.
 * With no key (or --mock) it runs on the mock model and plants one invented claim in a need and in a profile,
 * so the Critic must send both back. Writes out/<run>/needs.json, profiles.json, shortlists.json and trace.jsonl,
 * then checks the result.
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join as joinPath } from "node:path"
import { parseArgs } from "node:util"
import { DATA_DIR, FIXTURE_DIR, loadDataset, type Dataset } from "../../data"
import { join, modelFor, startRuntime, state, whenSettled } from "../../runtime"
import { createTraceObserver } from "../../trace"
import type { Task } from "../../types"
import { analyzeCompanies, createAnalysts } from "../analyst"
import { checkByCode, createCritic, type Critic } from "../critic"
import { createProfilerPool, type ProfilerPool } from "./pool"

async function main(): Promise<void> {
	try {
		process.loadEnvFile()
	} catch {
		// No .env: keys come from the shell, or the run is a mock.
	}
	const { values } = parseArgs({
		options: {
			mock: { type: "boolean", default: false },
			full: { type: "boolean", default: false },
			companies: { type: "string" },
			ids: { type: "string" },
			analysts: { type: "string", default: "3" },
			profilers: { type: "string", default: "4" },
			k: { type: "string", default: "5" },
		},
	})
	const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-workers" + (values.mock ? "-mock" : "")
	const s = startRuntime({ runId, mock: values.mock })
	const trace = createTraceObserver("out")
	join(trace.participant)
	if (s.mock && !values.mock) console.log("no API key: running on the mock model")

	const data = loadDataset(values.full ? DATA_DIR : FIXTURE_DIR)
	const companyIds = values.ids
		? values.ids.split(",").map((id) => id.trim())
		: [...data.companies.keys()].slice(0, values.companies ? Number(values.companies) : undefined)
	for (const id of companyIds) if (!data.companies.has(id)) throw new Error(`Unknown company ${id}`)
	const critic = createCritic({ store: data.sources, model: () => modelFor("critic") })
	join(critic.agent)
	const analysts = createAnalysts(Number(values.analysts), { data, mockPlantFakeClaim: true })
	const pool = createProfilerPool({ data, size: Number(values.profilers), k: Number(values.k), mockPlantFakeClaim: true })

	console.log(`run ${runId} · ${s.mock ? "mock" : "real models"} · ${companyIds.length} companies · ${analysts.length} analysts · ${pool.profilers.length} profilers`)
	const started = Date.now()
	await whenSettled(analyzeCompanies(analysts, data, companyIds).map((task) => task.id))
	await settle(critic)
	const ms = Date.now() - started

	for (const need of s.needs.values()) {
		const list = pool.shortlist(need.challengeId)
		console.log(`  ${need.challengeId.padEnd(9)} ${need.triage.padEnd(19)} ${critic.status("need", need.challengeId)?.padEnd(9)} → ${list?.researcherIds.join(" ") || list?.reason || "-"}`)
	}
	for (const task of s.tasks.values()) {
		const taskMs = (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.createdAt)
		console.log(`  ${task.id.padEnd(12)} ${String(s.getParticipant(task.assignee)?.getManifest().name).padEnd(11)} ${task.status.padEnd(6)} ${String(taskMs).padStart(6)} ms  ${task.subjectId ?? ""}${task.error ? `  ${task.error}` : ""}`)
	}
	console.log(`needs ${s.needs.size} · profiles ${s.profiles.size} of ${data.researchers.size} researchers · critic ${JSON.stringify(critic.stats())}`)
	console.log(`overlap: up to ${maxOverlap(s.tasks.values(), "analyze")} analyses and ${maxOverlap(s.tasks.values(), "profile")} profiles at once · ${ms} ms`)
	console.log(`${s.budget.tokensUsed} tokens · $${s.budget.costUsd.toFixed(4)}${s.mock ? " (simulated)" : ""}`)

	// Every challenge's shortlist, also for needs the Critic dropped later.
	const shortlists = companyIds.flatMap((id) => data.companies.get(id)!.challenges).map((id) => pool.shortlist(id)).filter(Boolean)
	writeFileSync(joinPath(trace.dir, "needs.json"), JSON.stringify([...s.needs.values()], null, 2))
	writeFileSync(joinPath(trace.dir, "profiles.json"), JSON.stringify([...s.profiles.values()], null, 2))
	writeFileSync(joinPath(trace.dir, "shortlists.json"), JSON.stringify(shortlists, null, 2))
	await trace.close()
	console.log(`out: ${trace.dir}`)

	check(data, companyIds, pool, critic)
	console.log("checks passed")
}

/** Wait until the Critic is idle and no task runs, including the fixes its send-backs start. */
async function settle(critic: Critic): Promise<void> {
	for (;;) {
		await critic.idle()
		const open = [...state().tasks.values()].filter((task) => task.status === "running" || task.status === "queued")
		if (!open.length) return
		await whenSettled(open.map((task) => task.id), 180_000)
	}
}

/** The most tasks of a kind that were running at the same moment. */
function maxOverlap(tasks: Iterable<Task>, kind: Task["kind"]): number {
	const edges = [...tasks]
		.filter((t) => t.kind === kind && t.startedAt)
		.flatMap((t) => [
			[t.startedAt!, 1],
			[t.finishedAt ?? Date.now(), -1],
		])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1])
	let now = 0
	let max = 0
	for (const [, step] of edges) max = Math.max(max, (now += step))
	return max
}

function check(data: Dataset, companyIds: string[], pool: ProfilerPool, critic: Critic): void {
	const s = state()
	const challengeIds = companyIds.flatMap((id) => data.companies.get(id)!.challenges)
	const dropped = (kind: "need" | "profile", id: string) => critic.status(kind, id) === "dropped"
	for (const id of challengeIds) assert.ok(s.needs.has(id) || dropped("need", id), `${id} has no need`)
	assert.ok(maxOverlap(s.tasks.values(), "analyze") > 1, "analyses must run at the same time")
	assert.ok(maxOverlap(s.tasks.values(), "profile") > 1, "profiles must run at the same time")
	const shortlisted = new Set(challengeIds.flatMap((id) => pool.shortlist(id)?.researcherIds ?? []))
	for (const id of s.profiles.keys()) assert.ok(shortlisted.has(id), `${id} was profiled but is on no shortlist`)

	// Every artifact left on the blackboard passes the Critic's code checks: ids exist and belong to the subject.
	for (const need of s.needs.values()) assert.deepEqual(checkByCode("need", need, s, data.sources).rejected, [], `${need.challengeId}: bad sources`)
	for (const profile of s.profiles.values()) {
		assert.deepEqual(checkByCode("profile", profile, s, data.sources).rejected, [], `${profile.researcherId}: bad sources`)
		const r = data.researcher(profile.researcherId)!
		assert.equal(profile.researcherId, r.id, "profiles are keyed by the canonical id")
		assert.equal(profile.canLead, r.canLead, `${r.id}: canLead comes from the data`)
		// A Critic fix may remove a stale availability claim, but none is ever invented.
		if (r.availability === null) assert.equal(profile.availability, null, `${r.id}: availability the data does not give`)
		assert.doesNotMatch(JSON.stringify(profile), /parental|maternity|paternity|family reasons|children/i, `${r.id}: no personal reason`)
	}
	for (const id of shortlisted) assert.notEqual(data.researcher(id)!.status, "departed", `departed ${id} shortlisted`)

	if (companyIds.includes("C006")) {
		assert.equal(s.needs.get("C006-CH2")?.triage, "not-research", "C006-CH2 (a Series A round) is not research")
		assert.equal(pool.shortlist("C006-CH2")?.researcherIds.length, 0, "a not-research need gets no candidates")
	}
	if (data.dir === FIXTURE_DIR) {
		for (const alias of ["R0139", "R0556"]) assert.ok(!s.profiles.has(alias), `${alias} is an alias, never a profile key`)
	}
	if (s.mock) {
		const sentBack = new Set(s.verdicts.filter((v) => v.action === "send-back").map((v) => v.kind))
		assert.ok(sentBack.has("need") && sentBack.has("profile"), "the planted claims must be sent back")
		const planted = /particle accelerator|quantum battery/i
		for (const need of s.needs.values()) assert.doesNotMatch(JSON.stringify(need), planted, `${need.challengeId}: the planted claim must be gone`)
		for (const profile of s.profiles.values()) assert.doesNotMatch(JSON.stringify(profile), planted, `${profile.researcherId}: the planted claim must be gone`)
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error)
	process.exit(1)
})
