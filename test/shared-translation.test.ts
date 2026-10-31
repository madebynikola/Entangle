import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { InferenceInput } from "@mozaik-ai/core"
import { createAnalyst } from "../src/agents/analyst"
import { createCritic, createTranslator, type Critic } from "../src/agents/critic"
import { readJsonBlock } from "../src/agents/matchmaker/shared"
import { createWriter } from "../src/agents/writer"
import type { WriteInput } from "../src/agents/writer/prompt"
import { Dataset, FIXTURE_DIR, readRaw } from "../src/data/dataset"
import { addProblem } from "../src/data/problem"
import { MockInferenceRunner, join, lastUserText, startRuntime, state, whenSettled } from "../src/runtime"
import { TRUE_CLAIMS, pair, profile } from "./critic-fixtures"

// Run: npx tsx --test test/shared-translation.test.ts

/** The two sentences of the Serbian reverse search (out/reverse-searches/serbian), and the first one in English. */
const SORTING = "Naša linija za sortiranje voća često pogrešno razvrstava jabuke sa sitnim oštećenjima kore i početnom truleži."
const CAMERA = "Probali smo kameru sa fiksnim pragovima boje, ali greška je i dalje oko 12% i kupci vraćaju robu."
const ENGLISH: Record<string, string> = {
	[SORTING]: "Our fruit sorting line often misgrades apples with minor skin damage and early rot.",
}

describe("one translation for the Analyst, the Critic and the Writer", () => {
	test("the Analyst writes from the English, and the Critic and the Writer get the same one without a new task", async () => {
		const translationCalls: string[] = []
		const messages: Record<string, string[]> = {}
		// Stands in for the models: translates each line (the first one as in ENGLISH), passes every claim, and records
		// what the Analyst and the Writer were asked. Their own mocks answer.
		const responder = (input: InferenceInput) => {
			const schema = input.structuredOutput?.name ?? ""
			const message = lastUserText(input)
			;(messages[schema] ??= []).push(message)
			if (schema === "record_translation") {
				translationCalls.push(message)
				const asked = message.split("Lines to translate:\n")[1].split("\n\n")[0].split("\n")
				const lines = asked.map((line, i) => {
					const serbian = line.replace(/^\d+\. /, "")
					return { line: i + 1, english: ENGLISH[serbian] ?? `In English: ${serbian.slice(0, 20)}` }
				})
				return JSON.stringify({ lines })
			}
			if (schema === "critic_review") {
				const count = message.split("\nSources:")[0].match(/^\d+\. /gm)?.length ?? 0
				return JSON.stringify({ checks: Array.from({ length: count }, (_, i) => ({ claim: i + 1, reason: "Stated.", supported: true })) })
			}
			if (schema === "critic_text_review") return JSON.stringify({ statements: [] })
			return undefined
		}
		startRuntime({ runId: "shared-translation-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [5, 15], responders: [responder] }) })
		const data = new Dataset(FIXTURE_DIR, readRaw(FIXTURE_DIR))
		const problem = addProblem(data, { text: `${SORTING} ${CAMERA}` })
		const translator = createTranslator("claude-haiku-4-5")
		const critic = createCritic({ store: data.sources, model: "claude-sonnet-4-6", dualReview: [], translator })
		join(critic.agent)
		const analyst = createAnalyst({ data, name: "analyst-shared", translator })
		const writer = createWriter({ name: "writer-shared", sources: data.sources, translator })

		analyst.analyze(problem.companyId)
		await settle(critic)
		const s = state()
		assert.equal(critic.status("need", problem.challengeId), "accepted")
		const [analysis] = messages.need_analysis
		assert.ok(analysis.includes(`"english":["${ENGLISH[SORTING]}"`), "the challenge carries its English in the Analyst's input")
		assert.ok(messages.critic_review[0].includes(`> ${ENGLISH[SORTING]}`), "the Critic reviews against the same English")

		// The Writer gets the need's Serbian record in English too, from the same translation.
		s.profiles.set("R0001", profile([TRUE_CLAIMS.coq]))
		s.candidates.set("C999-CH1:R0001", { ...pair([TRUE_CLAIMS.coq]), id: "C999-CH1:R0001", challengeId: problem.challengeId, companyId: problem.companyId })
		writer.write("C999-CH1:R0001")
		await settle(critic)
		const input = readJsonBlock<WriteInput>(messages.proposal?.[0] ?? "")
		assert.equal(input?.english?.["C999-CH1"]?.[0], ENGLISH[SORTING], "the Writer's input carries the cited record's English")

		assert.equal(translationCalls.length, 1, "one translation of the record for the whole run")
		const tasks = [...s.tasks.values()].filter((task) => task.kind === "translate")
		assert.deepEqual(
			tasks.map((task) => [task.subjectId, task.assignee]),
			[[problem.companyId, analyst.agent.getId()]],
			"made by the Analyst, the first agent that read the record",
		)
	})
})

async function settle(critic: Critic): Promise<void> {
	for (;;) {
		await critic.idle()
		// A task waits, queued, for its translations before it runs.
		await new Promise((resolve) => setTimeout(resolve, 20))
		const open = [...state().tasks.values()].filter((task) => task.status === "running" || task.status === "queued")
		if (!open.length) return
		await whenSettled(open.map((task) => task.id), 30_000)
	}
}
