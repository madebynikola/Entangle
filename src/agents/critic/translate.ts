import { SemanticEvent, type Agent, type StructuredOutputFormat } from "@mozaik-ai/core"
import { ROUTES } from "../../../config/models"
import {
	MockInferenceRunner,
	createTask,
	innerOf,
	providerOf,
	providersWithKeys,
	resolveRuntime,
	runTask,
	sendEvent,
	state,
	whenSettled,
	type MockResponder,
} from "../../runtime"
import type { SourceRecord } from "../../types"
import { clip } from "./text"

/**
 * English for the Serbian lines of dataset records. A model checking "bark damage" against
 * "oštećenja kore" translates the word the claim chose ("kora": bark), not the one the sentence means
 * (an apple's skin). A translation of the whole line, made before and apart from the claims, gets it right
 * more often. One run makes one per record and shares it: the Analyst and the Writer write from it, and the
 * Critic shows it under the original when it checks their claims, so all three read the same English.
 */

/** A record's Serbian lines were translated, once per run, by the first agent that needed them. */
export const RECORD_TRANSLATED = "record.translated"

/** Translations by record id: the English of each Serbian line, in order. */
export type Translations = Map<string, TranslatedLine[]>

export interface TranslatedLine {
	serbian: string
	english: string
}

/** Short words that are common in Serbian text and rare in English. */
const SERBIAN_WORDS = new Set(
	(
		"je su smo ste sam si i u na sa za da se od iz ili ali nije nisu koji koja koje kojih kao po do će ne još oko pri " +
		"kod što sve ima imamo nema naša naš naše našu vrlo često već samo kada jer bi biti bio bila nam nas ga ih ovo ova " +
		"ovaj taj ta to tih nego kroz među ka prema između posle pre radi bez"
	).split(" "),
)

const ENGLISH_WORDS = new Set(
	"the and of to in is are for with on that a an by from as at this we our be it was were has have not or which".split(" "),
)

/**
 * Whether a line is mainly Serbian: its common Serbian words and its lowercase words with č, ć, š, ž, đ or in
 * Cyrillic (names are capitalised, so "Kovačević" in an English line does not count) outnumber its common English
 * words, and there are at least two of them.
 */
export function isSerbian(line: string): boolean {
	const words = line.match(/[\p{L}]+/gu) ?? []
	let serbian = 0
	let english = 0
	for (const word of words) {
		const lower = word.toLowerCase()
		if (ENGLISH_WORDS.has(lower)) english++
		else if (SERBIAN_WORDS.has(lower)) serbian++
		else if (word === lower && /[čćšžđЀ-ӿ]/.test(word)) serbian++
	}
	return serbian >= 2 && serbian > english
}

/** The lines of a record's text that are mainly Serbian, without blank ones. */
export function serbianLines(text: string): string[] {
	return [...new Set(text.split("\n").map((line) => line.trim()).filter((line) => line && isSerbian(line)))]
}

export const TRANSLATION_SCHEMA: StructuredOutputFormat = {
	name: "record_translation",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["lines"],
		properties: {
			lines: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["line", "english"],
					properties: {
						line: { type: "integer", description: "The line number." },
						english: { type: "string", description: "The whole line in English." },
					},
				},
			},
		},
	},
}

/** The task that translates a record's Serbian lines, with the whole record as context. */
export function translationMessage(record: SourceRecord, lines: string[]): string {
	return [
		`This is not a review. Translate into English the Serbian lines of dataset record ${record.id} (${record.kind}: ${record.title}).`,
		"Translate each line whole, as a professional translator would. A Serbian word can have several English meanings:",
		"take the one the thing it is about needs (a fruit, a machine, a person, a contract). Keep numbers, names, units and",
		"ids exactly as written. Do not add, explain or leave out anything. Answer for every line, by its number.",
		"",
		"Lines to translate:",
		...lines.map((line, i) => `${i + 1}. ${line}`),
		"",
		"The whole record, for context:",
		record.text,
	].join("\n")
}

/** The model's answer as translated lines. A line it skipped or left empty has no translation. Throws on other JSON. */
export function parseTranslation(output: string | undefined, lines: string[]): TranslatedLine[] {
	const parsed = JSON.parse(output ?? "") as { lines?: Array<{ line?: number; english?: string }> }
	if (!Array.isArray(parsed.lines)) throw new Error("The translation has no lines")
	const byNumber = new Map(parsed.lines.map(({ line, english }) => [line, english?.trim()]))
	return lines.flatMap((serbian, i) => {
		const english = byNumber.get(i + 1)
		return english ? [{ serbian, english }] : []
	})
}

/** The translation as it shows under a record in a review prompt. */
export function translationBlock(lines: TranslatedLine[]): string {
	if (!lines.length) return ""
	return [
		"English translation of the Serbian lines above, made apart from the claims:",
		...lines.map(({ english }) => `> ${english}`),
	].join("\n")
}

/**
 * Each record's English for a block of JSON input: the record's id and the English of its Serbian lines, in order.
 * Records without Serbian lines are left out.
 */
export function englishById(translations: Translations): Record<string, string[]> {
	return Object.fromEntries([...translations].map(([id, lines]) => [id, lines.map(({ english }) => english)]))
}

export interface Translator {
	/**
	 * The English of the Serbian lines of these records. A record is translated the first time any agent asks, as a
	 * task of that agent about `subjectId`; later asks in the run get the same translation. A record without Serbian
	 * lines costs nothing and is left out.
	 */
	of(records: Iterable<SourceRecord | undefined>, asker: Agent, subjectId: string): Promise<Translations>
}

/** Tries per translation: a failed task or an unusable answer is tried once more. */
const TRIES = 2

/**
 * One run's translations, shared by the agents that read Serbian records. Create it after the runtime starts.
 * `model` defaults to `translateModel()`. In a mock run the tasks answer with no lines, and the agents read the
 * originals alone.
 */
export function createTranslator(model: string | (() => string) = translateModel): Translator {
	const pick = typeof model === "function" ? model : () => model
	const translated = new Map<string, Promise<TranslatedLine[]>>()
	const running = new Set<string>()
	const mock: MockResponder = (input) => (running.has(state().contextTasks.get(input.context.id) ?? "") ? JSON.stringify({ lines: [] }) : undefined)
	innerOf(resolveRuntime().getInferenceRunner(), MockInferenceRunner)?.responders.push(mock)

	async function translate(record: SourceRecord, asker: Agent, subjectId: string): Promise<TranslatedLine[]> {
		const lines = serbianLines(record.text)
		if (!lines.length) return []
		const task = createTask("translate", asker, subjectId)
		const chosen = pick()
		running.add(task.id)
		let english: TranslatedLine[] | undefined
		let error = ""
		for (let attempt = 0; attempt < TRIES && !english; attempt++) {
			runTask(task, translationMessage(record, lines), { model: chosen, structuredOutput: TRANSLATION_SCHEMA })
			await whenSettled([task.id])
			try {
				if (task.status !== "done") throw new Error(task.error ?? `translation task ${task.status}`)
				english = parseTranslation(task.output, lines)
			} catch (e) {
				error = e instanceof Error ? e.message : String(e)
			}
		}
		running.delete(task.id)
		const payload = {
			taskId: task.id,
			recordId: record.id,
			model: chosen,
			lines: lines.length,
			english: (english ?? []).map((line) => clip(line.english, 300)),
			...(!english && { error }),
		}
		sendEvent(SemanticEvent.create(RECORD_TRANSLATED, asker.getId(), payload), asker.getId())
		return english ?? []
	}

	return {
		async of(records, asker, subjectId) {
			const unique = new Map([...records].flatMap((record) => (record ? [[record.id, record] as const] : [])))
			const english: Translations = new Map()
			await Promise.all(
				[...unique.values()].map(async (record) => {
					let pending = translated.get(record.id)
					if (!pending) {
						pending = translate(record, asker, subjectId)
						translated.set(record.id, pending)
					}
					const lines = await pending
					if (lines.length) english.set(record.id, lines)
				}),
			)
			return english
		},
	}
}

/**
 * The model that translates Serbian records [MODEL_TRANSLATE]: else the first model of the analyst route (the cheap
 * tier, config/models.ts) whose provider has a key, or its first model when no key is set. On the Serbian reverse
 * search Haiku 4.5 and Sonnet 4.6 both translate "oštećenja kore" as skin damage, and Haiku costs a third.
 */
export function translateModel(): string {
	const pinned = process.env.MODEL_TRANSLATE
	if (pinned) return pinned
	const keyed = providersWithKeys()
	return ROUTES.analyst.models.find((model) => !keyed.length || keyed.includes(providerOf(model))) ?? ROUTES.analyst.models[0]
}
