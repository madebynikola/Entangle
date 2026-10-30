/**
 * Research Profiler and Industry Analyst tests, on the fixture and the mock model.
 *
 *   npx tsx --test src/agents/profiler/workers.test.ts
 */
import assert from "node:assert/strict"
import { before, describe, test } from "node:test"
import type { InferenceInput } from "@mozaik-ai/core"
import { FIXTURE_DIR, loadDataset } from "../../data"
import { MockInferenceRunner, join, lastUserText, startRuntime, state, whenSettled } from "../../runtime"
import type { CompanyNeed, Task } from "../../types"
import { analystResponder, analyzeCompanies, createAnalysts } from "../analyst"
import { checkByCode, createCritic, type Critic } from "../critic"
import { createProfilerPool, type ProfilerPool } from "./pool"
import { ClaimFilter } from "./shared"
import { retrievalText, shortlistFor, unavailable } from "./shortlist"

const data = loadDataset(FIXTURE_DIR)

function need(overrides: Partial<CompanyNeed> = {}): CompanyNeed {
	return {
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
		...overrides,
	}
}

describe("claim filter (no model)", () => {
	test("keeps the subject's own ids, canonical; drops foreign ids, empty claims and repeats", () => {
		const own = new Set(["R0539", "SYN-PUB-00001"])
		const filter = new ClaimFilter((id) => {
			const canonical = data.canonicalId(id)
			return own.has(canonical) ? canonical : undefined
		})
		const claims = filter.list([
			{ text: "  Works on   formal methods. ", sourceIds: ["R0139", "SYN-PUB-99999"] },
			{ text: "Works on formal methods.", sourceIds: ["R0539"] },
			{ text: "Cites only someone else.", sourceIds: ["R0001"] },
			{ text: "", sourceIds: ["R0539"] },
			"not a claim",
		])
		assert.deepEqual(claims, [{ text: "Works on formal methods.", sourceIds: ["R0539"] }])
		assert.deepEqual(filter.removedIds, ["SYN-PUB-99999", "R0001"])
		assert.equal(filter.dropped, 4)
	})
})

describe("shortlist (no model)", () => {
	test("a not-research need gets no candidates, with the reason", () => {
		const list = shortlistFor(data, need({ triage: "not-research", triageReason: "A funding round." }))
		assert.deepEqual(list.researcherIds, [])
		assert.match(list.reason ?? "", /not a research problem/)
	})

	test("queries with the search terms, returns k canonical ids, never a departed researcher", () => {
		assert.match(retrievalText(need()), /^anomaly detection, .*\. anomaly detection, /)
		const list = shortlistFor(data, need(), { k: 4 })
		assert.equal(list.researcherIds.length, 4)
		for (const id of list.researcherIds) {
			assert.equal(data.canonicalId(id), id)
			assert.notEqual(data.researcher(id)!.status, "departed")
		}
	})

	test("departed and fully unavailable researchers are out; emeritus who consult stay in", () => {
		assert.equal(unavailable(data.researcher("R0068")!), "has left the university")
		assert.equal(unavailable(data.researcher("R0079")!), null)
		assert.equal(unavailable(data.researcher("R0881")!), null, "R0881 still consults, per open_to and notes")
		assert.equal(unavailable(data.researcher("R0019")!), null)
	})

	test("exclude leaves researchers out", () => {
		const first = shortlistFor(data, need(), { k: 2 }).researcherIds
		const next = shortlistFor(data, need(), { k: 2, exclude: first }).researcherIds
		assert.equal(next.some((id) => first.includes(id)), false)
	})
})

describe("analysts and profilers on the Mozaik runtime", () => {
	let critic: Critic
	let pool: ProfilerPool
	let analyses: Task[]
	let flakyCalls = 0

	/** Leaves the last challenge out of the first analysis of C001, so the Analyst must ask again. */
	const flaky = (input: InferenceInput) => {
		if (input.structuredOutput?.name !== "need_analysis" || !lastUserText(input).startsWith("Company C001") || flakyCalls++ > 0) return undefined
		const answer = JSON.parse(analystResponder(input)!)
		answer.needs.pop()
		return JSON.stringify(answer)
	}

	before(async () => {
		const s = startRuntime({ runId: "workers-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [10, 40], responders: [flaky] }) })
		critic = createCritic({ store: data.sources, model: "claude-sonnet-4-6" })
		join(critic.agent)
		const analysts = createAnalysts(2, { data, mockPlantFakeClaim: true })
		pool = createProfilerPool({ data, size: 3, k: 3, mockPlantFakeClaim: true })
		analyses = analyzeCompanies(analysts, data)
		await whenSettled(analyses.map((t) => t.id))
		for (;;) {
			await critic.idle()
			const open = [...s.tasks.values()].filter((t) => t.status === "running" || t.status === "queued")
			if (!open.length) break
			await whenSettled(open.map((t) => t.id), 20_000)
		}
	})

	test("one analysis per company, split over the analysts, all running at once", () => {
		assert.equal(analyses.length, data.companies.size)
		assert.equal(new Set(analyses.map((t) => t.assignee)).size, 2)
		assert.ok(analyses.every((t) => t.status === "done"))
		const s = state()
		for (const challengeId of data.challenges.keys()) assert.ok(s.needs.has(challengeId), `${challengeId} has a need`)
	})

	test("an answer that misses a challenge is retried in the same task", () => {
		const c001 = analyses.find((t) => t.subjectId === "C001")!
		assert.equal(c001.attempts, 2)
		assert.ok(state().needs.has(data.companies.get("C001")!.challenges.at(-1)!))
	})

	test("needs carry the company's identity from the data, and only its own sources", () => {
		const s = state()
		for (const n of s.needs.values()) {
			const company = data.companies.get(n.companyId)!
			assert.equal(n.companyName, company.name)
			assert.equal(n.restatement.sourceIds[0], n.challengeId)
			assert.deepEqual(checkByCode("need", n, s, data.sources).rejected, [])
		}
		assert.equal(s.needs.get("C006-CH2")!.triage, "not-research")
		assert.deepEqual(pool.shortlist("C006-CH2")!.researcherIds, [])
	})

	test("each need is shortlisted as it lands; each candidate is profiled once", () => {
		const s = state()
		const profileTasks = [...s.tasks.values()].filter((t) => t.kind === "profile")
		const firstTasks = new Map<string, Task>()
		for (const task of profileTasks) if (!firstTasks.has(task.subjectId!)) firstTasks.set(task.subjectId!, task)
		const shortlisted = new Set([...s.needs.keys()].flatMap((id) => pool.shortlist(id)?.researcherIds ?? []))
		assert.deepEqual(new Set(firstTasks.keys()), shortlisted)
		assert.deepEqual(new Set(s.profiles.keys()), shortlisted)
		assert.ok(new Set(profileTasks.map((t) => t.assignee)).size > 1, "profiles spread over the pool")
		// The first profile started before the last analysis finished: no fixed stages.
		const firstProfile = Math.min(...profileTasks.map((t) => t.startedAt!))
		const lastAnalysis = Math.max(...analyses.map((t) => t.finishedAt!))
		assert.ok(firstProfile < lastAnalysis)
	})

	test("profiles take identity, canLead and availability from the data", async () => {
		const s = state()
		for (const p of s.profiles.values()) {
			const r = data.researcher(p.researcherId)!
			assert.equal(p.researcherId, r.id)
			assert.equal(p.name, r.name)
			assert.equal(p.canLead, r.canLead)
			if (r.availability === null) assert.equal(p.availability, null, `${r.id}: availability the data does not give`)
			assert.deepEqual(checkByCode("profile", p, s, data.sources).rejected, [])
		}
		const anyNeed = [...s.needs.keys()].find((id) => pool.shortlist(id)!.researcherIds.length)!
		const profiles = await pool.whenProfiled(anyNeed)
		assert.deepEqual(profiles.map((p) => p.researcherId), pool.shortlist(anyNeed)!.researcherIds)
	})

	test("an alias is profiled under its main id, once", () => {
		const task = pool.profile("R0139")
		assert.equal(task.subjectId, "R0539")
		assert.equal(pool.profile("R0539"), task)
	})

	test("the planted claims are sent back, fixed, and accepted", () => {
		const s = state()
		const sentBack = s.verdicts.filter((v) => v.action === "send-back")
		assert.deepEqual(new Set(sentBack.map((v) => v.kind)), new Set(["need", "profile"]))
		for (const verdict of sentBack) {
			assert.equal(critic.status(verdict.kind!, verdict.proposalId), "accepted")
		}
		const planted = /particle accelerator|quantum battery/i
		assert.doesNotMatch(JSON.stringify([...s.needs.values(), ...s.profiles.values()]), planted)
	})
})
