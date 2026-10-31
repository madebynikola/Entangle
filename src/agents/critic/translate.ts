import type { StructuredOutputFormat } from "@mozaik-ai/core"
import type { SourceRecord } from "../../types"

/**
 * English for the Serbian lines of the records the Critic reads. A model checking "bark damage" against
 * "oštećenja kore" translates the word the claim chose ("kora": bark), not the one the sentence means
 * (an apple's skin). A translation of the whole line, made before and apart from the claims, gets it right
 * more often. The Critic makes one per record per run and shows it under the original.
 */

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
