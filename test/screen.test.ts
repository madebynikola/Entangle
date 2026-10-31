/**
 * The shortlist filter: a decision model rates a wide shortlist and only the most likely candidates are profiled.
 *
 *   npx tsx --test test/screen.test.ts
 */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join as joinPath } from "node:path"
import { after, before, describe, test } from "node:test"
import { FIXTURE_DIR, loadDataset } from "../src/data"
import { cutShortlist, createProfilerPool, lexicalFit, readFit, screenDecision, screenInput, shortlistFor, type ProfilerPool } from "../src/agents/profiler"
import { MockInferenceRunner, SnapRunner, join, screenRated, startRuntime, state } from "../src/runtime"
import { createTraceObserver, type TraceObserver } from "../src/trace"
import type { CompanyNeed, TraceRecord } from "../src/types"

const data = loadDataset(FIXTURE_DIR)

const need: CompanyNeed = {
	challengeId: "C001-CH1",
	companyId: "C001",
	companyName: "ArmaturaSec d.o.o.",
	sector: "Cybersecurity",
	triage: "research",
	triageReason: "Open question.",
	restatement: { text: "Unsupervised anomaly detection on Modbus and BACnet traffic without labelled attacks.", sourceIds: ["C001-CH1"] },
	searchTerms: ["anomaly detection", "industrial control systems", "Modbus", "intrusion detection", "network traffic"],
	assets: [],
	constraints: [],
}

describe("cut (no model)", () => {
	const wide = { challengeId: "C001-CH1", researcherIds: ["R1", "R2", "R3", "R4", "R5"], skipped: [{ researcherId: "R9", reason: "has left the university" }] }
	const settings = { model: "subq-snap-1.1", threshold: 0.2 }

	test("keeps the k most likely, cuts those under the threshold, keeps retrieval's skips", () => {
		const list = cutShortlist(wide, { R1: 0.1, R2: 0.9, R3: 0.5, R4: 0.7, R5: 0.5 }, 2, settings)
		assert.deepEqual(list.researcherIds, ["R2", "R4"])
		assert.deepEqual(
			list.skipped.map((s) => [s.researcherId, s.reason]),
			[
				["R9", "has left the university"],
				["R3", "subq-snap-1.1: 50% likely to fit, below the top 2"],
				["R5", "subq-snap-1.1: 50% likely to fit, below the top 2"],
				["R1", "subq-snap-1.1: 10% likely to fit, under 0.2"],
			],
		)
		assert.equal(list.reason, undefined)
	})

	test("a candidate with no answer comes after the rated ones and is not cut", () => {
		assert.deepEqual(cutShortlist(wide, { R2: 0.3, R4: 0.05 }, 3, settings).researcherIds, ["R2", "R1", "R3"])
	})

	test("no candidate at or above the threshold leaves the need with none, and says why", () => {
		const list = cutShortlist(wide, { R1: 0.1, R2: 0.1, R3: 0.1, R4: 0.1, R5: 0.1 }, 2, settings)
		assert.deepEqual(list.researcherIds, [])
		assert.match(list.reason ?? "", /rates no candidate 20% likely/)
	})

	test("rates 8 candidates for a shortlist of 2 or 4, and widen times k for a longer one", () => {
		const defaults = { rated: 8, widen: 2 }
		assert.equal(screenRated(2, defaults), 8)
		assert.equal(screenRated(4, defaults), 8)
		assert.equal(screenRated(6, defaults), 12)
		assert.equal(screenRated(2, { rated: 4, widen: 2 }), 4)
		assert.equal(screenRated(2, { rated: 8, widen: 4 }), 8)
	})
})

describe("decision (no model)", () => {
	const ids = shortlistFor(data, need, { k: 4 }).researcherIds
	const input = screenInput(data, need, ids)

	test("one yes/no question per candidate, against the challenge and the candidates' record topics", () => {
		const decision = screenDecision(input)
		const questions = Object.values(decision.questions)
		assert.equal(questions.length, ids.length)
		assert.ok(questions.every((q) => q.type === "noul"))
		assert.match(questions[0].instructions, new RegExp(`researcher ${ids[0]} .*challenge C001-CH1`))
		assert.deepEqual(input.researchers.map((r) => r.id), ids)
		assert.ok(input.researchers.every((r) => r.publications.length <= 10))
	})

	test("the answers become a probability per researcher id", () => {
		const decision = screenDecision(input)
		const answers = Object.fromEntries(Object.keys(decision.questions).map((name, i) => [name, { type: "noul" as const, noul: i / 10 }]))
		const fit = readFit(decision.answer(answers), ids)
		assert.deepEqual(fit, Object.fromEntries(ids.map((id, i) => [id, i / 10])))
	})

	test("readFit keeps only listed ids with a probability in 0..1", () => {
		assert.deepEqual(readFit(JSON.stringify({ fit: { [ids[0]]: 0.4, [ids[1]]: 3, R0000: 0.9 } }), ids), { [ids[0]]: 0.4 })
		assert.equal(readFit("not json", ids), undefined)
		assert.equal(readFit(JSON.stringify({ fit: {} }), ids), undefined)
	})

	test("the mock's fit rates a candidate by the search terms their record topics cover", () => {
		const fit = lexicalFit(input)
		assert.deepEqual(Object.keys(fit), ids)
		assert.ok(Object.values(fit).every((p) => p >= 0 && p <= 1))
		assert.ok(Object.values(fit).some((p) => p > 0))
	})
})

describe("filter on the Mozaik runtime, through the snap runner", () => {
	const failing: CompanyNeed = { ...need, challengeId: "C001-CH2" }
	const requests: Array<{ url: string; auth: string | null; body: any }> = []
	const realFetch = globalThis.fetch
	let pool: ProfilerPool
	let trace: TraceObserver
	let traceClosed: Promise<void> | undefined
	const closeTrace = () => (traceClosed ??= trace.close())
	/** The stub's probability for the i-th candidate it is asked about. */
	const fitOf = (i: number) => [0.1, 0.9, 0.6, 0.3, 0.05, 0.8, 0.4, 0.7][i % 8]

	before(() => {
		// The default decision model, the same one the second Critic uses.
		delete process.env.SUBQ_MODEL
		process.env.SUBQ_API_KEY = "test-key"
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body))
			requests.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body })
			if (body.state.challenge.id === failing.challengeId) return new Response(JSON.stringify({ detail: "no credits" }), { status: 402 })
			const answers = Object.fromEntries(Object.keys(body.questions).map((name, i) => [name, { type: "noul", noul: fitOf(i) }]))
			return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 1200, output_tokens: 0 } }), { status: 200 })
		}) as typeof fetch
		startRuntime({ runId: "screen-test", mock: true, runner: new SnapRunner(new MockInferenceRunner({ latencyMs: [5, 20] })) })
		trace = createTraceObserver(mkdtempSync(joinPath(tmpdir(), "screen-test-")))
		join(trace.participant)
		pool = createProfilerPool({ data, size: 2, k: 2, followNeeds: false, screen: true })
	})

	after(async () => {
		globalThis.fetch = realFetch
		await closeTrace()
	})

	test("rates 8 candidates in one call, then profiles only the k most likely", async () => {
		const wide = shortlistFor(data, need, { k: 8 }).researcherIds
		const list = await pool.forNeed(need)

		assert.equal(requests.length, 1)
		const [request] = requests
		assert.equal(request.url, "https://api.subq.ai/v1/systemone")
		assert.equal(request.auth, "Bearer test-key")
		assert.equal(request.body.model, "subq-snap-1.1")
		assert.deepEqual(request.body.state.researchers.map((r: { id: string }) => r.id), wide)
		assert.equal(Object.keys(request.body.questions).length, wide.length)

		const expected = wide.map((id, i) => ({ id, p: fitOf(i) })).filter(({ p }) => p >= 0.2).sort((a, b) => b.p - a.p).slice(0, 2).map(({ id }) => id)
		assert.deepEqual(list.researcherIds, expected)
		assert.deepEqual(Object.keys(list.fit ?? {}), wide)
		assert.equal(await pool.forNeed(need), list, "a second call returns the first shortlist")

		const s = state()
		const profiled = [...s.tasks.values()].filter((t) => t.kind === "profile").map((t) => t.subjectId)
		assert.deepEqual(profiled, expected)
		const screens = [...s.tasks.values()].filter((t) => t.kind === "screen")
		assert.equal(screens.length, 1)
		assert.equal(screens[0].status, "done")
		assert.equal(screens[0].model, "subq-snap-1.1")
		assert.equal(screens[0].inputTokens, 1200)
	})

	test("a failed call keeps retrieval's top k", async () => {
		const list = await pool.forNeed(failing)
		assert.deepEqual(list.researcherIds, shortlistFor(data, failing, { k: 2 }).researcherIds)
		assert.equal(list.fit, undefined)
		const screen = [...state().tasks.values()].find((t) => t.kind === "screen" && t.subjectId === failing.challengeId)
		assert.equal(screen?.status, "failed")
		assert.match(screen?.error ?? "", /402/)
	})

	test("the call is in the trace like other model calls, with its tokens and cost", async () => {
		await Promise.all([pool.whenProfiled(need.challengeId), pool.whenProfiled(failing.challengeId)])
		await closeTrace()
		const records = readFileSync(trace.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as TraceRecord)
		const completed = records.find((r) => r.kind === "inference.completed" && r.model === "subq-snap-1.1")
		assert.ok(completed, "an inference.completed record for subq-snap-1.1")
		assert.equal(completed.agent, "shortlist-filter")
		assert.match(completed.taskId ?? "", /^screen-/)
		assert.deepEqual(completed.tokens, { input: 1200, output: 0, total: 1200 })
		assert.ok(Math.abs((completed.costUsd ?? 0) - (1200 * 0.04) / 1e6) < 1e-12)
		const ready = records.find((r) => r.kind === "shortlist.ready")
		assert.ok((ready?.data as { fit?: object }).fit, "shortlist.ready carries the probabilities")
	})
})
