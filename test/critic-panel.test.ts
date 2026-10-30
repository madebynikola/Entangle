import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join as joinPath } from "node:path"
import { after, before, describe, test } from "node:test"
import { SituationSpecification, createAgent, createHuman, type Agent, type SemanticEvent } from "@mozaik-ai/core"
import {
	CRITIC_DROPPED,
	CRITIC_ESCALATED,
	CRITIC_SENT_BACK,
	CRITIC_SPLIT,
	CRITIC_VERDICT,
	SentBackToMe,
	createCritic,
	lexicalReview,
	postArtifact,
	secondCriticModel,
	sentBackTask,
	strictReview,
	type Critic,
} from "../src/agents/critic"
import { MockInferenceRunner, join, runTask, startRuntime, state, whenSettled } from "../src/runtime"
import { createTraceObserver, type TraceObserver } from "../src/trace"
import type { Claim, CriticVerdict, Proposal, SentBack, TraceRecord } from "../src/types"
import { FAKE_CLAIMS, TRUE_CLAIMS, pair, proposal, store } from "./critic-fixtures"

// Run: npx tsx --test test/critic-panel.test.ts

/** True words, invented year: the first reviewer's mock skips numbers, the second's does not. */
const INVENTED_YEAR: Claim = {
	text: "Formalized a register allocation pass in the Coq proof assistant in 2019.",
	sourceIds: ["SYN-PUB-00001"],
}

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "MODEL_CRITIC_2"]
const savedEnv = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
const clearEnv = () => KEYS.forEach((key) => delete process.env[key])
const restoreEnv = () => KEYS.forEach((key) => (savedEnv[key] === undefined ? delete process.env[key] : (process.env[key] = savedEnv[key])))

describe("the two reviewers' mocks", () => {
	test("the second reviewer's mock catches an invented year that the first one passes", () => {
		const sources = new Map([["SYN-PUB-00001", store.get("SYN-PUB-00001")!]])
		const trueYear = { text: "Proved in Coq that a register allocation pass preserves program semantics (2013).", sourceIds: ["SYN-PUB-00001"] }
		const borderline = { text: "Built a register allocation pass that runs inside embedded controllers.", sourceIds: ["SYN-PUB-00001"] }
		const claims = [TRUE_CLAIMS.coq, INVENTED_YEAR, trueYear, borderline]
		const subject = "researcher Natalija Fejsa (R0001)"
		assert.deepEqual(lexicalReview(claims, sources, subject).map((c) => c.supported), [true, true, true, true])
		const strict = strictReview(claims, sources, subject)
		assert.deepEqual(strict.map((c) => c.supported), [true, false, true, false])
		assert.match(strict[1].reason, /2019/)
	})

	test("the second model comes from another provider when it can", () => {
		try {
			clearEnv()
			assert.equal(secondCriticModel("claude-sonnet-4-6"), "gpt-5.5", "no key: any listed model")
			process.env.ANTHROPIC_API_KEY = "test"
			assert.equal(secondCriticModel("claude-sonnet-4-6"), "claude-haiku-4-5", "one provider: another of its models")
			process.env.GEMINI_API_KEY = "test"
			assert.equal(secondCriticModel("claude-sonnet-4-6"), "gemini-3.1-pro-preview")
			process.env.MODEL_CRITIC_2 = "gemini-3.5-flash"
			assert.equal(secondCriticModel("claude-sonnet-4-6"), "gemini-3.5-flash", "pinned")
		} finally {
			restoreEnv()
		}
	})
})

describe("two reviewers on the Mozaik runtime", () => {
	const events: SemanticEvent[] = []
	const listeners = new Set<(event: SemanticEvent) => void>()
	let critic: Critic
	let trace: TraceObserver
	let traceClosed: Promise<void> | undefined
	const closeTrace = () => (traceClosed ??= trace.close())
	let fixer: Agent
	let stubborn: Agent

	before(() => {
		clearEnv()
		startRuntime({ runId: "critic-panel-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [20, 60] }) })
		trace = createTraceObserver(mkdtempSync(joinPath(tmpdir(), "critic-panel-test-")))
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
		// A writer that drops every rejected claim, and one that never changes anything.
		fixer = writer("writer-fix", (rejected, claims) => claims.filter((claim) => !rejected.has(claim.text)))
		stubborn = writer("writer-stubborn", (_, claims) => claims)
		;[fixer, stubborn].forEach(join)
		state().candidates.set("C001-CH1:R0001", pair([TRUE_CLAIMS.coq, TRUE_CLAIMS.firmware]))
	})

	after(async () => {
		await closeTrace()
		restoreEnv()
	})

	test("both must pass: one send-back carries the claims either reviewer rejected", async () => {
		const s = state()
		const doc = proposal([TRUE_CLAIMS.coq, INVENTED_YEAR, FAKE_CLAIMS.inventedPatent], "Builds on SYN-PUB-00001 for C001-CH1.")
		s.proposals.set(doc.id, doc)
		postArtifact("proposal", doc.id, fixer.getId(), "write-test")

		await waitFor((e) => e.type === CRITIC_VERDICT && isFor(e, doc.id) && (e.payload as { action: string }).action === "accept")
		const verdicts = verdictsFor(doc.id)
		assert.deepEqual(verdicts.map((v) => v.action), ["send-back", "accept"])

		const [first] = verdicts
		assert.deepEqual(
			first.reviewers?.map((r) => [r.reviewer, r.model, r.rejected]),
			[
				["critic", "claude-sonnet-4-6", 1],
				["critic-2", "gpt-5.5", 2],
			],
		)
		assert.deepEqual(
			first.rejected.map((r) => [r.claim.text, r.reviewers]),
			[
				[INVENTED_YEAR.text, ["critic-2"]],
				[FAKE_CLAIMS.inventedPatent.text, ["critic", "critic-2"]],
			],
		)
		assert.match(first.rejected[1].reason, /^critic: .+ critic-2: /)

		const sentBacks = events.filter((e) => e.type === CRITIC_SENT_BACK && isFor(e, doc.id))
		assert.equal(sentBacks.length, 1, "one send-back for both reviewers")
		assert.equal((sentBacks[0].payload as SentBack).rejected.length, 2)

		const split = events.find((e) => e.type === CRITIC_SPLIT && isFor(e, doc.id))
		assert.ok(split, "the disagreement is an event")
		const splitClaims = (split.payload as { claims: { claim: Claim; rejectedBy: string[] }[] }).claims
		assert.deepEqual(splitClaims.map((c) => [c.claim.text, c.rejectedBy]), [[INVENTED_YEAR.text, ["critic-2"]]])

		// Three critique tasks at the same time: one per reviewer on the claims, and the first one's on the free text.
		// The fixed proposal needs no model call: its claims passed and its free text did not change.
		const critiques = [...s.tasks.values()].filter((task) => task.kind === "critique" && task.subjectId === doc.id)
		assert.deepEqual(critiques.map((task) => task.assignee), [critic.agent.getId(), critic.second!.getId(), critic.agent.getId()])
		assert.ok(Math.max(...critiques.map((t) => t.startedAt!)) < Math.min(...critiques.map((t) => t.finishedAt!)))
		assert.deepEqual(s.proposals.get(doc.id)!.claims, [TRUE_CLAIMS.coq])
		assert.equal(critic.status("proposal", doc.id), "accepted")
	})

	test("when the fixes run out, the proposal waits for a person instead of being dropped", async () => {
		const s = state()
		const doc: Proposal = { ...proposal([TRUE_CLAIMS.coq, INVENTED_YEAR], "Builds on SYN-PUB-00001."), id: "P-stubborn" }
		s.proposals.set(doc.id, doc)
		postArtifact("proposal", doc.id, stubborn.getId(), "write-test-2")

		const escalated = await waitFor((e) => e.type === CRITIC_ESCALATED && isFor(e, doc.id))
		assert.equal((escalated.payload as { sendBacks: number }).sendBacks, 2)
		assert.deepEqual(verdictsFor(doc.id).map((v) => v.action), ["send-back", "send-back", "human-review"])
		assert.equal(events.some((e) => e.type === CRITIC_DROPPED && isFor(e, doc.id)), false)
		assert.ok(s.proposals.has(doc.id), "the proposal stays on the blackboard")
		assert.equal(critic.status("proposal", doc.id), "needs-human")
		assert.equal(critic.stats().escalated, 1)
	})

	test("a pair still has one reviewer", async () => {
		postArtifact("pair", "C001-CH1:R0001", fixer.getId())
		await critic.idle()
		const critiques = [...state().tasks.values()].filter((t) => t.kind === "critique" && t.subjectId === "C001-CH1:R0001")
		assert.deepEqual(critiques.map((t) => t.assignee), [critic.agent.getId()])
		assert.equal(verdictsFor("C001-CH1:R0001").at(-1)?.reviewers, undefined)
	})

	test("the trace shows both reviewers and where they disagreed", async () => {
		await closeTrace()
		const records = readFileSync(trace.path, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as TraceRecord)
		const reviewers = new Set(records.filter((r) => r.kind === "critic.reviewing" && r.taskId).map((r) => r.agent))
		assert.deepEqual([...reviewers].sort(), ["critic", "critic-2"])
		const answeredBy = new Set(records.filter((r) => r.kind === "model.answer").map((r) => r.agent))
		assert.ok(answeredBy.has("critic-2"), "the second reviewer runs its own loops")
		assert.ok(records.some((r) => r.kind === CRITIC_SPLIT && r.taskId))
		assert.ok(records.some((r) => r.kind === CRITIC_ESCALATED))
	})

	function writer(name: string, fix: (rejected: Set<string>, claims: Claim[]) => Claim[]): Agent {
		return createAgent({
			name,
			capabilities: ["inference"],
			instruction: "Test writer.",
			tools: [],
			handlers: [
				{
					specification: new SentBackToMe(),
					processor: {
						async apply({ event, participant }) {
							const sentBack = event.payload as SentBack
							const task = sentBackTask(sentBack)
							runTask(task, "Fix the rejected claims.", { model: "claude-haiku-4-5" })
							await whenSettled([task.id])
							const rejected = new Set(sentBack.rejected.map((r) => r.claim.text))
							const s = state()
							const current = s.proposals.get(sentBack.id)!
							s.proposals.set(sentBack.id, { ...current, claims: fix(rejected, current.claims), revision: current.revision + 1 })
							postArtifact("proposal", sentBack.id, participant.getId(), task.id)
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

	function verdictsFor(id: string): CriticVerdict[] {
		return state().verdicts.filter((v) => v.proposalId === id)
	}
})

class AnyEvent extends SituationSpecification {
	isSatisfiedBy(): boolean {
		return true
	}
}

function isFor(event: SemanticEvent, id: string): boolean {
	return (event.payload as { id?: string }).id === id
}
