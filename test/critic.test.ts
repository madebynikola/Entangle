import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join as joinPath } from "node:path"
import { after, before, describe, test } from "node:test"
import { SituationSpecification, createAgent, createHuman, type Agent, type SemanticEvent } from "@mozaik-ai/core"
import {
	CRITIC_DROPPED,
	CRITIC_REVIEWING,
	CRITIC_SENT_BACK,
	CRITIC_TRIMMED,
	CRITIC_VERDICT,
	FakeSourceStore,
	SentBackToMe,
	checkByCode,
	createCritic,
	describeRejections,
	lexicalReview,
	postArtifact,
	sentBackTask,
	type Critic,
} from "../src/agents/critic"
import { MatchState, MockInferenceRunner, join, runTask, startRuntime, state, whenSettled } from "../src/runtime"
import { createTraceObserver, type TraceObserver } from "../src/trace"
import { trimArtifact } from "../src/agents/critic/checks"
import { reviewMessage } from "../src/agents/critic/prompt"
import type { ArtifactKind, Claim, CriticVerdict, SentBack, SourceRecord, TraceRecord } from "../src/types"
import { FAKE_CLAIMS, RECORDS, TRUE_CLAIMS, need, pair, profile, proposal, store } from "./critic-fixtures"

// Run: npx tsx --test test/critic.test.ts

describe("code checks (no model)", () => {
	const s = new MatchState("unit", true)

	test("cuts a leftover claim from a proposal's claims and Markdown, but never its last problem claim", () => {
		const cite = (c: Claim) => `${c.text} [${c.sourceIds.join(", ")}]`
		const markdown =
			`## Verified packet filtering\n\n**Company:** ${cite(TRUE_CLAIMS.hiring)}  \n\n### The problem\n${cite(TRUE_CLAIMS.firmware)}\n\n` +
			`### What each side brings\n- **Company:** ${cite(TRUE_CLAIMS.testBench)} ${cite(FAKE_CLAIMS.inventedPatent)}\n` +
			`- **Faculty:** ${cite(FAKE_CLAIMS.someoneElsesPaper)}\n\n### Why this pair\n- ${cite(TRUE_CLAIMS.coq)}\n\n### Sources\n- C001-CH1`
		const claims = [TRUE_CLAIMS.hiring, TRUE_CLAIMS.firmware, TRUE_CLAIMS.testBench, FAKE_CLAIMS.inventedPatent, FAKE_CLAIMS.someoneElsesPaper, TRUE_CLAIMS.coq]
		const reject = (c: Claim) => ({ claim: { ...c }, reason: "not in the source", check: "unsupported" as const })
		const doc = { ...proposal(claims, markdown), id: "P-trim" }

		assert.equal(trimArtifact(s, "proposal", doc.id, doc, [reject(FAKE_CLAIMS.inventedPatent), reject(FAKE_CLAIMS.someoneElsesPaper)]), true)
		const trimmed = s.proposals.get(doc.id)!
		assert.deepEqual(trimmed.claims, [TRUE_CLAIMS.hiring, TRUE_CLAIMS.firmware, TRUE_CLAIMS.testBench, TRUE_CLAIMS.coq])
		assert.match(trimmed.markdown, /- \*\*Company:\*\* The company has the full firmware source and a hardware test bench\. \[C001-CH1\]\n\n### Why/)
		assert.doesNotMatch(trimmed.markdown, /solid-state|LoRaWAN|\*\*Faculty:\*\*/)

		for (const core of [TRUE_CLAIMS.firmware, TRUE_CLAIMS.hiring, TRUE_CLAIMS.coq]) {
			s.proposals.set(doc.id, doc)
			assert.equal(trimArtifact(s, "proposal", doc.id, doc, [reject(core)]), false, core.text)
			assert.equal(s.proposals.get(doc.id), doc, "nothing changed")
		}
		const freeText = { claim: { text: "The company has an accelerometer.", sourceIds: [] }, reason: "no", check: "free-text" as const }
		assert.equal(trimArtifact(s, "proposal", doc.id, doc, [freeText]), false)
	})

	test("reject an invented paper, someone else's paper and a claim with no source", () => {
		const result = checkByCode(
			"profile",
			profile([TRUE_CLAIMS.coq, FAKE_CLAIMS.inventedPaper, FAKE_CLAIMS.someoneElsesPaper, FAKE_CLAIMS.noSource]),
			s,
			store,
		)
		assert.deepEqual(result.passed, [TRUE_CLAIMS.coq, TRUE_CLAIMS.openTo])
		assert.deepEqual(checksByText(result.rejected), {
			[FAKE_CLAIMS.inventedPaper.text]: "unknown-source",
			[FAKE_CLAIMS.someoneElsesPaper.text]: "wrong-subject",
			[FAKE_CLAIMS.noSource.text]: "no-source",
		})
	})

	test("reject a name that does not fit the id; word order and Cyrillic are fine", () => {
		const wrong = checkByCode("profile", profile([TRUE_CLAIMS.coq], { name: "Nina Mamužić" }), s, store)
		assert.deepEqual(wrong.rejected.map((r) => r.check), ["name-mismatch"])
		const cyrillic = checkByCode("profile", profile([TRUE_CLAIMS.coq], { name: "Фејса Наталија" }), s, store)
		assert.deepEqual(cyrillic.rejected, [])
	})

	test("a need may cite its own challenge and pages, not another company", () => {
		const result = checkByCode(
			"need",
			need({ assets: [TRUE_CLAIMS.testBench, TRUE_CLAIMS.hiring, { text: "Grows vegetables.", sourceIds: ["C002"] }] }),
			s,
			store,
		)
		assert.equal(result.passed.length, 3)
		assert.deepEqual(result.rejected.map((r) => r.check), ["wrong-subject"])
	})

	test("a pair may cite both sides; a proposal's text may not cite an unknown id", () => {
		assert.deepEqual(checkByCode("pair", pair([TRUE_CLAIMS.coq, TRUE_CLAIMS.hiring]), s, store).rejected, [])
		const result = checkByCode(
			"proposal",
			proposal([TRUE_CLAIMS.coq], "Builds on SYN-PUB-00001 and on SYN-PUB-77777 for challenge C001-CH1."),
			s,
			store,
		)
		assert.deepEqual(
			result.rejected.map((r) => [r.claim.sourceIds[0], r.check]),
			[["SYN-PUB-77777", "unknown-source"]],
		)
	})

	test("reject a name or number that only a record the claim does not cite holds", () => {
		const page = (id: string, text: string): SourceRecord => ({ id, kind: "page", title: "ArmaturaSec", text, researcherIds: [], companyId: "C001", year: 2024 })
		const bench = page("C001/blog/2024-05-20/Bench", "Every build runs for 72 hours on the bench against six PLC models.")
		const job = page("C001/job/2024-06-01/Test Engineer", "You will test our firmware on programmable logic controllers from several vendors.")
		const pages = new FakeSourceStore([...RECORDS, bench, job])
		const claim = (text: string, id = "C001-CH1"): Claim => ({ text, sourceIds: [id] })
		const yocto = claim("The NetGuard-OT packet filter runs on a custom Yocto build.")
		const hours = claim("The packet filter firmware is tested for 72 hours on a hardware test bench.")
		const fine = [
			claim("Every build runs on the bench against six PLC models.", bench.id),
			// "PLCs" is spelled out in the job page, although only the bench page writes "PLC".
			claim("The company tests its firmware on PLCs from several vendors.", job.id),
			// A clause on what is missing, the company's own name, and a name that no record holds (the model's part).
			claim("The challenge does not say whether the firmware runs on Yocto."),
			claim("ArmaturaSec needs stronger guarantees than testing."),
			claim("The filter must run on Siemens hardware."),
		]

		const result = checkByCode("need", need({ assets: [yocto, hours, ...fine] }), s, pages)
		assert.deepEqual(checksByText(result.rejected), { [yocto.text]: "uncited-detail", [hours.text]: "uncited-detail" })
		assert.deepEqual(
			result.rejected.map((r) => r.reason),
			[
				`"Yocto" is not in C001-CH1 but is in C001, which the claim does not cite.`,
				`"72 hours" is not in C001-CH1 but is in ${bench.id}, which the claim does not cite.`,
			],
		)
		assert.deepEqual(result.passed, [TRUE_CLAIMS.firmware, ...fine])
	})

	test("pass another form of a name in a cited record; blame no record for a page path or a work's small number", () => {
		const page = (id: string, text: string): SourceRecord => ({ id, kind: "page", title: "ArmaturaSec", text, researcherIds: [], companyId: "C001", year: 2023 })
		const news = page(
			"C001/news/2023-03-28/Contract",
			"ArmaturaSec signed with partners in Vojvodini and Hungary for 1.200 units. The units run on STM32H7 boards and give text-to-speech alerts.",
		)
		const blog = page(
			"C001/blog/2023-05-20/Installers",
			"Installers in Vojvodina and Hungarian partners set up 1,200 units on 28 sites, all on STM32 boards with TTS alerts. They report to a team of 20 that manages delivery.",
		)
		const paper: SourceRecord = { id: "SYN-PUB-00003", kind: "publication", title: "Testing a Verified Register Allocator", text: "We test the verified pass on 12 embedded programs.", researcherIds: ["R0001"], year: 2014 }
		const records = new FakeSourceStore([...RECORDS, news, blog, paper])
		const claim = (text: string, id: string): Claim => ({ text, sourceIds: [id] })
		const fine = [
			// The news page writes the Serbian "Vojvodini", "Hungary" and "1.200".
			claim("The company has partners in Vojvodina and Hungarian sites for 1,200 units.", news.id),
			// A model family, an acronym with "to" in it, and a page path that leaves no "28" and still ends its sentence.
			claim(`The units run on STM32 boards (${news.id}). They give TTS alerts.`, news.id),
			// The blog "manages", which is not "Manager".
			claim("A Manager signs every contract.", news.id),
			claim("Installers set up units on 28 sites.", blog.id),
		]
		const team = claim("The company has a team of 20 firmware engineers.", "C001-CH1")

		const result = checkByCode("need", need({ assets: [...fine, team] }), s, records)
		assert.deepEqual(result.passed, [TRUE_CLAIMS.firmware, ...fine])
		// A number under 100 that a company page holds still counts.
		assert.deepEqual(
			result.rejected.map((r) => r.reason),
			[`"20" is not in C001-CH1 but is in ${blog.id}, which the claim does not cite.`],
		)

		// Another paper by the researcher holds "12" by chance.
		const programs = claim("Formalized a register allocation pass in Coq and tested it on 12 programs.", "SYN-PUB-00001")
		const tested = claim("Tested a verified register allocator on embedded programs.", paper.id)
		assert.deepEqual(checkByCode("profile", profile([programs, tested]), s, records).rejected, [])
	})
})

describe("code check: abbreviations", () => {
	const s = new MatchState("unit", true)
	const make = (id: string, kind: SourceRecord["kind"], text: string): SourceRecord => ({ id, kind, title: id, text, researcherIds: [], companyId: "C001", year: 2024 })
	const cited = make("C001-CH7", "challenge", "Our wearable patch misses atrial fibrillation episodes. The solar yield of photovoltaic arrays drops, and the electrocardiogram is noisy.")
	const other = make("C001/blog/2024-07-01/Patches", "page", "AF detection with PV inverters and ECG patches.")
	const records = new FakeSourceStore([...RECORDS, cited, other])
	const claim = (text: string): Claim => ({ text, sourceIds: [cited.id] })
	// A claim of the same artifact cites the page, so the lookup reaches it.
	const companion: Claim = { text: "AF detection with PV inverters and ECG patches.", sourceIds: [other.id] }
	const rejected = (text: string) => checkByCode("need", need({ assets: [claim(text), companion] }), s, records).rejected.map((r) => r.reason)

	test("pass a two-letter acronym and a one-word abbreviation that a cited record spells out", () => {
		assert.deepEqual(rejected("AF episodes are missed."), [])
		assert.deepEqual(rejected("PV arrays lose yield."), [])
		assert.deepEqual(rejected("The ECG is noisy."), [])
	})

	test("still blame a two-letter name that no cited record spells", () => {
		const nothing = make("C001-CH8", "challenge", "Our patch misses episodes when patients walk.")
		const none = new FakeSourceStore([...RECORDS, nothing, other])
		const result = checkByCode("need", need({ assets: [{ text: "AF episodes are missed.", sourceIds: [nothing.id] }, companion] }), s, none)
		assert.deepEqual(
			result.rejected.map((r) => r.reason),
			[`"AF" is not in C001-CH8 but is in ${other.id}, which the claim does not cite.`],
		)
	})
})

describe("mock model check", () => {
	test("rejects the planted patent claim and keeps the true ones", () => {
		const sources = new Map(["SYN-PUB-00001", "SYN-PRJ-0001", "R0001"].map((id) => [id, store.get(id)!]))
		const claims = [TRUE_CLAIMS.coq, TRUE_CLAIMS.certsafe, TRUE_CLAIMS.openTo, FAKE_CLAIMS.inventedPatent]
		const checks = lexicalReview(claims, sources, "researcher Natalija Fejsa (R0001)")
		assert.deepEqual(
			checks.map((check) => check.supported),
			[true, true, true, false],
		)
	})
})

describe("review prompt", () => {
	// A researcher record as long as the real ones (~2,700 chars), with availability at the end.
	const long: SourceRecord = {
		...store.get("R0001")!,
		text: `${"Fields: formal methods and program verification. ".repeat(60)}Notes: available from autumn 2026.`,
	}
	const short = store.get("SYN-PUB-00001")!
	const claims = [{ text: "Available from autumn 2026.", sourceIds: ["R0001"] }, TRUE_CLAIMS.coq]
	const sources = new Map([
		["R0001", long],
		["SYN-PUB-00001", short],
	])

	test("shows whole records, so the end of a long profile is there", () => {
		assert.ok(long.text.length > 2500)
		const message = reviewMessage("profile", "R0001", { line: "researcher Natalija Fejsa (R0001)" }, claims, sources)
		assert.ok(message.includes("Notes: available from autumn 2026."))
		assert.ok(message.includes(short.text))
	})

	test("over the total, cuts the longest record and keeps the short one whole", () => {
		const message = reviewMessage("profile", "R0001", { line: "R0001" }, claims, sources, 3000)
		assert.ok(message.includes(short.text))
		assert.ok(!message.includes("Notes: available"))
		assert.ok(message.includes("…"))
	})
})

describe("review loop on the Mozaik runtime", () => {
	const events: SemanticEvent[] = []
	const listeners = new Set<(event: SemanticEvent) => void>()
	let critic: Critic
	let trace: TraceObserver
	let traceClosed: Promise<void> | undefined
	const closeTrace = () => (traceClosed ??= trace.close())
	let fixer: Agent
	let stubborn: Agent
	let writer: Agent

	before(() => {
		startRuntime({ runId: "critic-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [20, 60] }) })
		trace = createTraceObserver(mkdtempSync(joinPath(tmpdir(), "critic-test-")))
		join(trace.participant)
		join(
			createHuman({
				name: "recorder",
				capabilities: ["observer"],
				handlers: [
					{
						specification: new AnyEvent(),
						processor: {
							apply: ({ event }) => {
								events.push(event)
								listeners.forEach((listener) => listener(event))
							},
						},
					},
				],
			}),
		)
		critic = createCritic({ store, model: "claude-sonnet-4-6" })
		join(critic.agent)
		// A producer that fixes a sent-back profile by removing the rejected claims, and one that never fixes anything.
		fixer = producer("profiler-test", (rejected, claims) => claims.filter((claim) => !rejected.has(claim.text)))
		stubborn = producer("analyst-test", (_, claims) => claims)
		writer = createAgent({ name: "writer-test", capabilities: ["inference"], instruction: "Test writer.", tools: [], handlers: [] })
		;[fixer, stubborn, writer].forEach(join)
	})

	after(closeTrace)

	test("catches the planted fake claims, sends the profile back, and accepts the fix", async () => {
		const s = state()
		s.profiles.set(
			"R0001",
			profile([TRUE_CLAIMS.coq, TRUE_CLAIMS.certsafe, FAKE_CLAIMS.inventedPatent, FAKE_CLAIMS.inventedPaper]),
		)
		postArtifact("profile", "R0001", fixer.getId(), "profile-test")

		await waitFor((e) => e.type === CRITIC_VERDICT && is(e, "profile", "R0001") && verdict(e).action === "accept")

		const verdicts = verdictsFor("profile", "R0001")
		assert.deepEqual(
			verdicts.map((v) => v.action),
			["send-back", "accept"],
		)
		assert.deepEqual(checksByText(verdicts[0].rejected), {
			[FAKE_CLAIMS.inventedPatent.text]: "unsupported",
			[FAKE_CLAIMS.inventedPaper.text]: "unknown-source",
		})

		const sentBack = events.find((e) => e.type === CRITIC_SENT_BACK && is(e, "profile", "R0001"))!.payload as SentBack
		assert.equal(sentBack.producerId, fixer.getId())
		assert.equal(sentBack.attempt, 1)
		assert.equal(s.tasks.get(sentBack.taskId)?.assignee, fixer.getId())

		const texts = s.profiles.get("R0001")!.expertise.map((claim) => claim.text)
		assert.deepEqual(texts, [TRUE_CLAIMS.coq.text, TRUE_CLAIMS.certsafe.text])
		assert.equal(critic.status("profile", "R0001"), "accepted")

		// The fix changed nothing the model had already found supported, so the second review needs no model call.
		const reviewing = events.filter((e) => e.type === CRITIC_REVIEWING && is(e, "profile", "R0001"))
		assert.deepEqual(
			reviewing.map((e) => (e.payload as { modelCheck: number }).modelCheck),
			[4, 0],
		)
	})

	test("after two send-backs that fix nothing, cuts the claim and keeps the rest", async () => {
		const s = state()
		const fake: Claim = { text: "The company runs a private 5G test network in Novi Sad.", sourceIds: ["C001-CH1"] }
		s.needs.set("C001-CH1", need({ assets: [TRUE_CLAIMS.testBench, fake] }))
		postArtifact("need", "C001-CH1", stubborn.getId(), "analyze-test")

		const trimmed = await waitFor((e) => e.type === CRITIC_TRIMMED && is(e, "need", "C001-CH1"))
		assert.equal((trimmed.payload as { sendBacks: number }).sendBacks, 2)
		assert.deepEqual((trimmed.payload as { claims: { claim: Claim }[] }).claims.map((c) => c.claim.text), [fake.text])
		const verdicts = verdictsFor("need", "C001-CH1")
		assert.deepEqual(verdicts.map((v) => v.action), ["send-back", "send-back", "accept"])
		assert.deepEqual(verdicts[2].trimmed?.map((r) => r.claim.text), [fake.text])
		assert.deepEqual(
			events.filter((e) => e.type === CRITIC_SENT_BACK && is(e, "need", "C001-CH1")).map((e) => (e.payload as SentBack).attempt),
			[1, 2],
		)
		assert.deepEqual(s.needs.get("C001-CH1")?.assets, [TRUE_CLAIMS.testBench])
		assert.equal(critic.status("need", "C001-CH1"), "accepted")
		assert.equal(critic.stats().trimmed, 1)
	})

	test("drops an artifact when the claim its fixes could not save is a core one", async () => {
		const s = state()
		const fake: Claim = { text: "The company needs a verified TLS stack for its satellite modems.", sourceIds: ["C001-CH1"] }
		s.needs.set("C001-CH2", need({ challengeId: "C001-CH2", restatement: fake }))
		postArtifact("need", "C001-CH2", stubborn.getId(), "analyze-test-2")

		const dropped = await waitFor((e) => e.type === CRITIC_DROPPED && is(e, "need", "C001-CH2"))
		assert.equal((dropped.payload as { sendBacks: number }).sendBacks, 2)
		assert.deepEqual(verdictsFor("need", "C001-CH2").map((v) => v.action), ["send-back", "send-back", "drop"])
		assert.equal(s.needs.has("C001-CH2"), false)
		assert.equal(critic.status("need", "C001-CH2"), "dropped")
	})

	test("reviews artifacts in parallel as they land", async () => {
		const s = state()
		const formalJob: Claim = {
			text: "The job ad asks for experience with formal verification.",
			sourceIds: ["C001/job/2024-02-05/Firmware Engineer"],
		}
		const ethernet: Claim = { text: "The packet filter firmware runs on industrial Ethernet segments.", sourceIds: ["C001-CH1"] }
		const lora: Claim = { text: "Proposed energy-aware routing for dense LoRaWAN sensor deployments.", sourceIds: ["SYN-PUB-00002"] }
		const p = pair([TRUE_CLAIMS.coq, formalJob])
		const doc = proposal([ethernet], "Builds on SYN-PUB-00001 and SYN-PUB-77777 for C001-CH1.")
		s.candidates.set(p.id, p)
		s.proposals.set(doc.id, doc)
		s.profiles.set("R0002", profile([lora], { researcherId: "R0002", name: "Marko Ilić", industryFit: [] }))
		postArtifact("pair", p.id, writer.getId())
		postArtifact("proposal", doc.id, writer.getId())
		postArtifact("profile", "R0002", writer.getId())
		await critic.idle()

		assert.equal(critic.status("pair", p.id), "accepted")
		assert.equal(critic.status("profile", "R0002"), "accepted")
		assert.equal(critic.status("proposal", doc.id), "sent-back")
		const [proposalVerdict] = verdictsFor("proposal", doc.id)
		assert.deepEqual(proposalVerdict.rejected.map((r) => [r.claim.sourceIds[0], r.check]), [["SYN-PUB-77777", "unknown-source"]])

		const critiques = [...s.tasks.values()].filter(
			(task) => task.kind === "critique" && [p.id, doc.id, "R0002"].includes(task.subjectId ?? ""),
		)
		// Two reviewers check the proposal's claims and one its free text, one each the pair and the profile.
		assert.equal(critiques.length, 5)
		const lastStart = Math.max(...critiques.map((task) => task.startedAt!))
		const firstEnd = Math.min(...critiques.map((task) => task.finishedAt!))
		assert.ok(lastStart < firstEnd, "all five critique loops ran at the same time")
	})

	test("every intervention is in the trace, tied to a task", async () => {
		await closeTrace()
		const records = readFileSync(trace.path, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as TraceRecord)
		const interventions = records.filter((r) => [CRITIC_VERDICT, CRITIC_SENT_BACK, CRITIC_DROPPED].includes(r.kind))
		assert.ok(interventions.length >= 9)
		for (const record of interventions) assert.equal(record.agent, "critic")
		for (const record of records.filter((r) => r.kind === CRITIC_SENT_BACK)) assert.match(record.taskId ?? "", /^(profile|analyze|write)-\d+$/)
	})

	function producer(name: string, fix: (rejected: Set<string>, claims: Claim[]) => Claim[]): Agent {
		return createAgent({
			name,
			capabilities: ["inference"],
			instruction: "Test producer.",
			tools: [],
			handlers: [
				{
					specification: new SentBackToMe(),
					processor: {
						async apply({ event, participant }) {
							const sentBack = event.payload as SentBack
							const task = sentBackTask(sentBack)
							runTask(task, describeRejections(sentBack), { model: "claude-haiku-4-5" })
							await whenSettled([task.id])
							const rejected = new Set(sentBack.rejected.map((r) => r.claim.text))
							const s = state()
							if (sentBack.kind === "profile") {
								const current = s.profiles.get(sentBack.id)!
								s.profiles.set(sentBack.id, { ...current, expertise: fix(rejected, current.expertise) })
							} else if (sentBack.kind === "need") {
								const current = s.needs.get(sentBack.id)!
								s.needs.set(sentBack.id, { ...current, assets: fix(rejected, current.assets) })
							}
							postArtifact(sentBack.kind, sentBack.id, participant.getId(), task.id)
						},
					},
				},
			],
		})
	}

	function waitFor(match: (event: SemanticEvent) => boolean, timeoutMs = 5000): Promise<SemanticEvent> {
		const found = events.find(match)
		if (found) return Promise.resolve(found)
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				listeners.delete(listener)
				reject(new Error("timed out waiting for an event"))
			}, timeoutMs)
			const listener = (event: SemanticEvent) => {
				if (!match(event)) return
				clearTimeout(timer)
				listeners.delete(listener)
				resolve(event)
			}
			listeners.add(listener)
		})
	}

	function verdictsFor(kind: ArtifactKind, id: string): CriticVerdict[] {
		return state().verdicts.filter((v) => v.kind === kind && v.proposalId === id)
	}
})

class AnyEvent extends SituationSpecification {
	isSatisfiedBy(): boolean {
		return true
	}
}

function is(event: SemanticEvent, kind: ArtifactKind, id: string): boolean {
	const payload = event.payload as { kind: string; id: string }
	return payload.kind === kind && payload.id === id
}

function verdict(event: SemanticEvent): { action: string } {
	return event.payload as { action: string }
}

function checksByText(rejected: { claim: Claim; check?: string }[]): Record<string, string | undefined> {
	return Object.fromEntries(rejected.map((r) => [r.claim.text, r.check]))
}
