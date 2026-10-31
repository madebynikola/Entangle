import assert from "node:assert/strict"
import { before, describe, test } from "node:test"
import { SituationSpecification, createAgent, createHuman, type InferenceInput, type SituationContext } from "@mozaik-ai/core"
import { CRITIC_TRANSLATED, FakeSourceStore, createCritic, postArtifact, translateModel, type Critic } from "../src/agents/critic"
import { reviewMessage } from "../src/agents/critic/prompt"
import { isSerbian, parseTranslation, serbianLines } from "../src/agents/critic/translate"
import { MockInferenceRunner, join, lastUserText, startRuntime, state, whenSettled } from "../src/runtime"
import type { SourceRecord } from "../src/types"
import { RECORDS, need } from "./critic-fixtures"

// Run: npx tsx --test test/critic-translate.test.ts

/** The problem of the Serbian reverse search (out/reverse-searches/serbian), as a challenge record. */
const SORTING = "Naša linija za sortiranje voća često pogrešno razvrstava jabuke sa sitnim oštećenjima kore i početnom truleži."
const CAMERA = "Probali smo kameru sa fiksnim pragovima boje, ali greška je i dalje oko 12% i kupci vraćaju robu."
const SERBIAN_CHALLENGE: SourceRecord = {
	id: "C001-CH1",
	kind: "challenge",
	title: SORTING,
	text: `${SORTING}\n\n${CAMERA}`,
	researcherIds: [],
	companyId: "C001",
}
const ENGLISH: Record<string, string> = {
	[SORTING]: "Our fruit sorting line often misgrades apples with minor skin damage and early rot.",
	[CAMERA]: "We tried a camera with fixed colour thresholds, but the error is still about 12% and customers return the goods.",
}

describe("Serbian lines", () => {
	test("finds the Serbian lines of a record and leaves English ones with Serbian names", () => {
		assert.deepEqual(serbianLines(SERBIAN_CHALLENGE.text), [SORTING, CAMERA])
		assert.ok(!isSerbian("Isidora Kovačević (R0147): Associate Professor, Department of Management, University of Novi Sad."))
		assert.ok(!isSerbian("Authors: Lazar Šarić (R0057); Milena Vuković (outside co-author)."))
		assert.ok(isSerbian("Uticaj morfološke redukcije na preciznost pretrage srpskih višeskriptnih dokumenata"))
		assert.ok(isSerbian("Наша линија често погрешно разврстава јабуке."))
		const mixed = "Bio: Born in Novi Sad.\nBio: Isidora Kovačević diplomirala je na Fakultetu tehničkih nauka u Novom Sadu 2004. godine."
		assert.deepEqual(serbianLines(mixed), [mixed.split("\n")[1]])
	})

	test("the cheap tier translates, unless MODEL_TRANSLATE pins a model", () => {
		const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "MODEL_TRANSLATE"]
		const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
		try {
			keys.forEach((key) => delete process.env[key])
			assert.equal(translateModel(), "claude-haiku-4-5")
			process.env.OPENAI_API_KEY = "test"
			assert.equal(translateModel(), "gpt-5.4-mini")
			process.env.MODEL_TRANSLATE = "claude-sonnet-4-6"
			assert.equal(translateModel(), "claude-sonnet-4-6")
		} finally {
			keys.forEach((key) => (saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key])))
		}
	})

	test("a line the model skipped or left empty has no translation", () => {
		const output = JSON.stringify({ lines: [{ line: 2, english: " The error is about 12%. " }, { line: 1, english: "" }] })
		assert.deepEqual(parseTranslation(output, [SORTING, CAMERA]), [{ serbian: CAMERA, english: "The error is about 12%." }])
		assert.throws(() => parseTranslation("{}", [SORTING]))
	})

	test("the review prompt shows the translation under the original", () => {
		const claims = [{ text: "The line misgrades apples with minor bark damage.", sourceIds: ["C001-CH1"] }]
		const translations = new Map([["C001-CH1", [{ serbian: SORTING, english: ENGLISH[SORTING] }]]])
		const message = reviewMessage("need", "C001-CH1", { line: "C001-CH1" }, claims, new Map([["C001-CH1", SERBIAN_CHALLENGE]]), undefined, translations)
		const original = message.indexOf(CAMERA)
		const english = message.indexOf(`> ${ENGLISH[SORTING]}`)
		assert.ok(original > 0 && english > original, "the English comes after the whole original")
		assert.match(message, /English translation of the Serbian lines above, made apart from the claims:/)
	})
})

describe("translation on the Mozaik runtime", () => {
	const translationCalls: string[] = []
	const reviews: string[] = []
	let critic: Critic

	before(() => {
		// Stands in for the models: translates the two known lines, and passes every claim it reviews.
		const translator = (input: InferenceInput) => {
			if (input.structuredOutput?.name !== "record_translation") return undefined
			const message = lastUserText(input)
			translationCalls.push(message)
			const lines = [SORTING, CAMERA].map((line, i) => ({ line: i + 1, english: ENGLISH[line] }))
			return JSON.stringify({ lines })
		}
		const reviewer = (input: InferenceInput) => {
			if (input.structuredOutput?.name !== "critic_review") return undefined
			const message = lastUserText(input)
			reviews.push(message)
			const count = message.split("\nSources:")[0].match(/^\d+\. /gm)?.length ?? 0
			return JSON.stringify({ checks: Array.from({ length: count }, (_, i) => ({ claim: i + 1, reason: "Stated.", supported: true })) })
		}
		startRuntime({ runId: "critic-translate-test", mock: true, runner: new MockInferenceRunner({ latencyMs: [5, 15], responders: [translator, reviewer] }) })
		const records = RECORDS.map((record) => (record.id === "C001-CH1" ? SERBIAN_CHALLENGE : record))
		critic = createCritic({ store: new FakeSourceStore(records), model: "claude-sonnet-4-6", dualReview: [] })
		join(critic.agent)
	})

	test("translates a cited Serbian record once per run and shows it in every review that cites it", async () => {
		const analyst = createAgent({ name: "analyst-sr", capabilities: ["inference"], instruction: "Posts needs.", tools: [], handlers: [] })
		join(analyst)
		const translated: unknown[] = []
		join(
			createHuman({
				name: "translation-observer",
				capabilities: ["observer"],
				handlers: [
					{
						specification: new Is(CRITIC_TRANSLATED),
						processor: {
							apply: ({ event }) => {
								const { recordId, lines, english } = event.payload as Record<string, unknown>
								translated.push({ recordId, lines, english })
							},
						},
					},
				],
			}),
		)
		const s = state()
		const restatement = { text: "The fruit sorting line often misgrades apples with minor skin damage and early rot.", sourceIds: ["C001-CH1"] }
		const assets = [{ text: "The company tried a camera with fixed colour thresholds.", sourceIds: ["C001-CH1"] }]
		s.needs.set("C001-CH1", need({ restatement, assets }))
		postArtifact("need", "C001-CH1", analyst.getId())
		await settle(critic)
		// A second version of the need, with a new claim, is reviewed against the same translation.
		s.needs.set("C001-CH1", need({ restatement, assets: [...assets, { text: "Customers return the goods.", sourceIds: ["C001-CH1"] }] }))
		postArtifact("need", "C001-CH1", analyst.getId())
		await settle(critic)

		assert.equal(translationCalls.length, 1, "one translation for the record in the whole run")
		const translations = [...s.tasks.values()].filter((task) => task.kind === "translate")
		assert.deepEqual(
			translations.map((task) => [task.subjectId, task.model]),
			[["C001-CH1", translateModel()]],
			"a task of its own about the need it was made for",
		)
		assert.ok(translationCalls[0].includes(`1. ${SORTING}`) && translationCalls[0].includes(SERBIAN_CHALLENGE.text))
		assert.equal(reviews.length, 2)
		for (const review of reviews) assert.ok(review.includes(`> ${ENGLISH[SORTING]}`))
		assert.deepEqual(translated, [{ recordId: "C001-CH1", lines: 2, english: [ENGLISH[SORTING], ENGLISH[CAMERA]] }])
		assert.deepEqual(state().verdicts.map((v) => v.action), ["accept", "accept"])
	})
})

class Is extends SituationSpecification {
	constructor(private readonly type: string) {
		super()
	}
	isSatisfiedBy({ event }: SituationContext): boolean {
		return event.type === this.type
	}
}

async function settle(critic: Critic): Promise<void> {
	for (;;) {
		await critic.idle()
		const open = [...state().tasks.values()].filter((task) => task.status === "running" || task.status === "queued")
		if (!open.length) return
		await whenSettled(open.map((task) => task.id), 30_000)
	}
}
