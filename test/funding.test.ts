import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, test } from "node:test"
import { fits, queryList } from "../src/agents/scout/scout"
import { fundingMarkdown } from "../src/agents/scout/render"
import { SAVED_CALLS, callQueries, callRecord, createEuCalls, fuse, savedEuCalls, toCall } from "../src/data/eucalls"
import type { FundingCall } from "../src/types"

// Run: npx tsx --test test/funding.test.ts

/** A portal result as the search API returns it (30 Oct 2026), trimmed. */
const TOPIC = {
	summary: "Advanced integrated photonic devices",
	metadata: {
		type: ["1"],
		status: ["31094501"],
		identifier: ["HORIZON-CL4-2027-05-DIGITAL-EMERGING-03"],
		title: ["Advanced integrated photonic devices for extended features and ultra-low power consumption (RIA)"],
		callIdentifier: ["HORIZON-CL4-2027-05"],
		typesOfAction: ["HORIZON  Research and Innovation Actions"],
		startDate: ["2026-11-17T00:00:00.000+0000"],
		deadlineDate: ["2027-03-18T00:00:00.000+0000"],
		keywords: ["HORIZON-CL4-2027-05-DIGITAL-EMERGING-03", "HORIZON-CL4-2027-05", "Optical engineering, photonics, lasers"],
		budgetOverview: [
			JSON.stringify({ budgetTopicActionMap: { "1": [{ minContribution: 3000000, maxContribution: 5000000, expectedGrants: 6 }] } }),
		],
	},
}

const TODAY = "2026-10-30"

describe("EU calls from the Funding & Tenders portal", () => {
	test("a topic becomes a call with the portal's own facts", () => {
		const call = toCall(TOPIC, TODAY)!
		assert.equal(call.id, "CALL:HORIZON-CL4-2027-05-DIGITAL-EMERGING-03")
		assert.equal(call.programme, "Horizon Europe")
		assert.equal(call.action, "Research and Innovation Actions")
		assert.equal(call.status, "forthcoming")
		assert.equal(call.opens, "2026-11-17")
		assert.equal(call.deadline, "2027-03-18")
		assert.deepEqual(call.grant, { min: 3000000, max: 5000000, expected: 6 })
		assert.deepEqual(call.keywords, ["Optical engineering, photonics, lasers"])
		assert.match(call.url, /topic-details\/HORIZON-CL4-2027-05-DIGITAL-EMERGING-03$/)
	})

	test("a call whose deadlines have passed, a closed call and a FAQ page are left out", () => {
		assert.equal(toCall({ ...TOPIC, metadata: { ...TOPIC.metadata, deadlineDate: ["2024-02-07T17:00:00.000+0000"] } }, TODAY), undefined)
		assert.equal(toCall({ ...TOPIC, metadata: { ...TOPIC.metadata, status: ["31094503"] } }, TODAY), undefined)
		assert.equal(toCall({ ...TOPIC, metadata: { ...TOPIC.metadata, type: ["0"] } }, TODAY), undefined)
	})

	test("a two-stage call gives its next deadline", () => {
		const call = toCall({ ...TOPIC, metadata: { ...TOPIC.metadata, deadlineDate: ["2026-09-01T00:00:00.000+0000", "2027-04-08T00:00:00.000+0000"] } }, TODAY)
		assert.equal(call?.deadline, "2027-04-08")
	})

	test("each term goes out alone with the area, never as an operator", () => {
		assert.deepEqual(callQueries(["AI for cybersecurity", "Modbus (ICS)", "OR", "anomaly detection", "AI for cybersecurity"], "Cybersecurity"), [
			"ai for cybersecurity",
			"modbus ics",
			"or",
			"anomaly detection",
			"cybersecurity",
		])
	})

	test("a call that several queries rank high comes first", () => {
		const call = (id: string) => ({ ...toCall(TOPIC, TODAY)!, id })
		const [a, b, c] = [call("CALL:A"), call("CALL:B"), call("CALL:C")]
		assert.deepEqual(fuse([[a, b], [c, b], [b]]).map((x) => x.id), ["CALL:B", "CALL:A", "CALL:C"])
	})

	test("the client posts the query, drops past deadlines and keeps each call as a source", async () => {
		const sent: string[] = []
		const past = { ...TOPIC, metadata: { ...TOPIC.metadata, identifier: ["OLD-1"], deadlineDate: ["2025-01-01T00:00:00.000+0000"] } }
		const fetch = (async (url: string | URL | Request) => {
			sent.push(String(url))
			return new Response(JSON.stringify({ results: [TOPIC, past] }))
		}) as typeof globalThis.fetch
		const eu = createEuCalls({ fetch, now: () => new Date(`${TODAY}T12:00:00Z`) })
		const result = await eu.search(["photonics", "low power", "sensors"])
		assert.equal(sent.length, 3, "one request per term")
		assert.match(sent[0], /apiKey=SEDIA/)
		assert.deepEqual(result.calls.map((call) => call.identifier), ["HORIZON-CL4-2027-05-DIGITAL-EMERGING-03"])
		assert.equal(eu.calls.get("CALL:HORIZON-CL4-2027-05-DIGITAL-EMERGING-03")?.kind, "call")
		await eu.search(["photonics", "low power", "sensors"])
		assert.equal(sent.length, 3, "the same terms are answered from the cache")
	})

	test("at most 4 requests run at once, over every search", async () => {
		let now = 0
		let peak = 0
		const fetch = (async () => {
			peak = Math.max(peak, ++now)
			await new Promise((resolve) => setTimeout(resolve, 5))
			now--
			return new Response(JSON.stringify({ results: [] }))
		}) as typeof globalThis.fetch
		const eu = createEuCalls({ fetch })
		await Promise.all([eu.search(["a", "b", "c", "d", "e"]), eu.search(["f", "g", "h"], "area")])
		assert.equal(peak, 4)
	})

	test("a failed request never throws: it says why", async () => {
		const fetch = (async () => new Response("", { status: 503 })) as typeof globalThis.fetch
		const result = await createEuCalls({ fetch }).search(["photonics"])
		assert.deepEqual(result.calls, [])
		assert.match(result.error ?? "", /503/)
	})

	test("the saved calls are valid calls", () => {
		const saved = JSON.parse(readFileSync(SAVED_CALLS, "utf8")) as FundingCall[]
		assert.ok(saved.length >= 10)
		for (const call of saved) assert.ok(call.id.startsWith("CALL:") && call.title && call.deadline && call.url)
	})
})

describe("the Funding Scout's answer", () => {
	const call = toCall(TOPIC, TODAY)!
	const other: FundingCall = { ...call, id: "CALL:DIGITAL-2027-X", identifier: "DIGITAL-2027-X", title: "Something else" }

	test("only calls the portal returned are kept, once each, with or without the prefix", () => {
		const picked = fits(
			{
				calls: [
					{ callId: "HORIZON-CL4-2027-05-DIGITAL-EMERGING-03", reason: "Covers ultra-low-power photonic sensing.", check: "Check the opening date." },
					{ callId: "CALL:HORIZON-CL4-2027-05-DIGITAL-EMERGING-03", reason: "Again.", check: "" },
					{ callId: "CALL:MADE-UP-1", reason: "Invented.", check: "" },
				],
				noneReason: "",
			},
			[call, other],
		)
		assert.equal(picked.calls.length, 1)
		assert.equal(picked.calls[0].call, call, "title, deadline and link are the portal's, not the model's")
		assert.equal(picked.calls[0].check, "Check the opening date.")
	})

	test("an answer that only names unknown calls is refused, so the task retries", () => {
		assert.throws(() => fits({ calls: [{ callId: "CALL:MADE-UP-1", reason: "x", check: "" }], noneReason: "" }, [call]), /none of the picked calls/)
	})

	test("the model's queries are trimmed, without repeats, at most 4", () => {
		assert.deepEqual(queryList([" AI for health ", "AI for health", "", "digital twins", "edge AI", "smart grids", "x"]), ["AI for health", "digital twins", "edge AI", "smart grids"])
		assert.throws(() => queryList([]), /no query/)
	})

	test("no fit keeps the reason", () => {
		assert.deepEqual(fits({ calls: [], noneReason: "The calls are about photonics; the problem is about welds." }, [call]), {
			calls: [],
			noneReason: "The calls are about photonics; the problem is about welds.",
		})
	})

	test("the proposal section links each call and says the Critic did not review it", () => {
		const markdown = fundingMarkdown({
			pairId: "C001-CH1:R0001",
			challengeId: "C001-CH1",
			companyId: "C001",
			researcherId: "R0001",
			calls: [{ call, reason: "Covers ultra-low-power photonic sensing.", check: "Check the opening date." }],
			queries: ["photonics"],
			considered: 1,
		})
		assert.match(markdown, /## Where to apply/)
		assert.match(markdown, /\[Advanced integrated photonic devices.*\]\(https:\/\/ec\.europa\.eu\/.*\)/)
		assert.match(markdown, /Opens 2026-11-17, deadline 2027-03-18/)
		assert.match(markdown, /EU grant €3,000,000–€5,000,000 per project, about 6 grants/)
		assert.match(markdown, /inovacionifond\.rs/)
		assert.match(markdown, /Critic does not review/)
	})

	test("a call as a source carries its facts and its link", () => {
		const record = callRecord(call)
		assert.equal(record.kind, "call")
		assert.deepEqual(record.researcherIds, [])
		assert.match(record.text, /Horizon Europe\. Research and Innovation Actions\. opens 2026-11-17, deadline 2027-03-18/)
		assert.equal(record.url, call.url)
	})

	test("saved calls answer a mock search without the network", async () => {
		const result = await savedEuCalls([call, other]).search(["photonics lasers"])
		assert.equal(result.calls[0].id, call.id)
	})
})
