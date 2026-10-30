/**
 * Try the Matchmaker and the Writers on the hand-made fixtures, with the real Critic and SourceStore.
 *
 *   npx tsx src/agents/matchmaker/try.ts [--mock | --local] [--writers N]
 *
 * --local runs every model call as a local Claude Code session on your own login (LOCAL_CLAUDE=1).
 * With no key (or --mock) it runs on the mock model and plants one invented claim, so the Critic must
 * send a proposal back. Writes out/<run>/proposals/*.md, pairs.json and trace.jsonl, then checks the result.
 */
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join as joinPath } from "node:path"
import { parseArgs } from "node:util"
import { join, localClaude, modelFor, providersWithKeys, startRuntime, state, whenSettled } from "../../runtime"
import { createTraceObserver } from "../../trace"
import { loadDataset } from "../../data"
import { createCritic, type Critic } from "../critic"
import { createWriter, writeAll } from "../writer"
import { FIXTURE_NEEDS, FIXTURE_PROFILES, FIXTURE_SHORTLISTS } from "./fixtures"
import { createMatchmaker } from "./matchmaker"
import { choosePairs } from "./select"

async function main(): Promise<void> {
	try {
		process.loadEnvFile()
	} catch {
		// No .env: keys come from the shell, or the run is a mock.
	}
	const { values } = parseArgs({ options: { mock: { type: "boolean", default: false }, local: { type: "boolean", default: false }, writers: { type: "string", default: "3" } } })
	if (values.local) process.env.LOCAL_CLAUDE = "1"
	// With no key the runtime runs on the mock anyway; the -mock suffix keeps the run out of git.
	const mock = values.mock || providersWithKeys().length === 0
	const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-try" + (mock ? "-mock" : "")
	const s = startRuntime({ runId, mock })
	const trace = createTraceObserver("out")
	join(trace.participant)
	if (mock && !values.mock) console.log("no API key: running on the mock model")

	const data = loadDataset()
	const critic = createCritic({ store: data.sources, model: modelFor("critic") })
	join(critic.agent)
	for (const need of FIXTURE_NEEDS) s.needs.set(need.challengeId, need)
	for (const profile of FIXTURE_PROFILES) s.profiles.set(profile.researcherId, profile)

	const matchmaker = createMatchmaker({})
	const writers = Array.from({ length: Number(values.writers) }, (_, i) =>
		createWriter({ name: `writer-${i + 1}`, sources: data.sources, mockPlantFakeClaim: true }),
	)

	console.log(`run ${runId} · ${s.mock ? "mock" : localClaude() ? "local Claude Code" : "API"} · ${FIXTURE_NEEDS.length} challenges · ${writers.length} writers`)
	const matches = FIXTURE_NEEDS.map((need) =>
		matchmaker.match(need, FIXTURE_SHORTLISTS[need.challengeId].map((id) => s.profiles.get(id)!)),
	)
	await whenSettled(matches.map((task) => task.id))
	await settle(critic)

	const order = FIXTURE_NEEDS.map((need) => need.challengeId)
	const accepted = [...s.candidates.values()].filter((pair) => critic.status("pair", pair.id) === "accepted")
	const chosen = choosePairs(accepted, {}, order)
	console.log(`pairs: ${s.candidates.size} proposed, ${accepted.length} accepted, ${chosen.length} chosen · no match: ${[...s.noMatches.keys()].join(", ")}`)

	writeAll(writers, chosen.map((pair) => pair.id))
	await settle(critic)

	const dir = joinPath(trace.dir, "proposals")
	mkdirSync(dir, { recursive: true })
	for (const proposal of s.proposals.values()) writeFileSync(joinPath(dir, `${proposal.id}.md`), proposal.markdown)
	writeFileSync(
		joinPath(trace.dir, "pairs.json"),
		JSON.stringify({ chosen: chosen.map((pair) => pair.id), pairs: [...s.candidates.values()], noMatches: [...s.noMatches.values()] }, null, 2),
	)
	for (const task of s.tasks.values()) {
		const ms = (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.createdAt)
		console.log(`  ${task.id.padEnd(12)} ${String(s.getParticipant(task.assignee)?.getManifest().name).padEnd(10)} ${task.status.padEnd(6)} ${String(ms).padStart(6)} ms  ${task.subjectId ?? ""}`)
	}
	console.log(`critic: ${JSON.stringify(critic.stats())}`)
	console.log(`${s.budget.tokensUsed} tokens · $${s.budget.costUsd.toFixed(4)}${s.mock ? " (simulated)" : ""}`)
	await trace.close()
	console.log(`proposals: ${dir}`)

	check(data.sources.has.bind(data.sources), chosen.length, critic)
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

function check(has: (id: string) => boolean, chosen: number, critic: Critic): void {
	const s = state()
	assert.ok(s.noMatches.has("C002-CH3"), "the not-research challenge C002-CH3 must end as a NoMatch")
	const proposals = [...s.proposals.values()]
	assert.ok(proposals.length >= 3, `want at least 3 proposals, got ${proposals.length}`)
	assert.equal(new Set(proposals.map((p) => p.pairId)).size, proposals.length, "one proposal per pair")
	assert.ok(chosen >= 3, "at least 3 pairs chosen")
	// After its last fix a proposal may wait for a person ("needs-human"); that is a valid end, a missing review is not.
	const accepted = proposals.filter((p) => critic.status("proposal", p.id) === "accepted")
	assert.ok(accepted.length >= 3, `want at least 3 proposals accepted by the Critic, got ${accepted.length}`)
	for (const proposal of proposals) {
		assert.match(String(critic.status("proposal", proposal.id)), /^(accepted|needs-human)$/, `${proposal.id} must end reviewed`)
		assert.doesNotMatch(proposal.markdown, /\b(he|she|his|her)\b/i, `${proposal.id} must not guess a gender`)
		for (const claim of proposal.claims) {
			assert.ok(claim.sourceIds.length > 0, `${proposal.id}: claim without a source: ${claim.text}`)
			for (const id of claim.sourceIds) assert.ok(has(id), `${proposal.id}: unknown source ${id}`)
		}
		assert.doesNotMatch(proposal.markdown, /parental|maternity|family reasons/i, `${proposal.id} must not give a reason for limited availability`)
	}
	if (s.mock) {
		const revised = proposals.filter((p) => p.revision > 0)
		assert.ok(revised.length >= 1, "the planted claim must be sent back and fixed")
		assert.ok(proposals.every((p) => !p.markdown.includes("SYN-PAT-999")), "the planted claim must be gone")
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error)
	process.exit(1)
})
