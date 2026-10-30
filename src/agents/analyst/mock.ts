import type { InferenceInput } from "@mozaik-ai/core"
import { fold } from "../../data"
import { lastUserText } from "../../runtime"
import type { ChallengeTriage, Claim } from "../../types"
import { readJsonBlock, type ClaimFix } from "../matchmaker/shared"
import { firstSentence, sentences } from "../profiler/shared"
import { NEED_FIX_SCHEMA, NEED_SCHEMA, type CompanyBundle, type NeedAnswer, type NeedDraft, type NeedFixInput } from "./prompt"

/**
 * Canned Analyst answers for mock runs, built from the input itself, so every id is real and every claim is a
 * sentence of its source: a keyword triage, the challenge's first sentence as restatement, its most frequent
 * content words as search terms. Need fixes drop every rejected claim.
 */
export function analystResponder(input: InferenceInput): string | undefined {
	const schema = input.structuredOutput?.name
	if (schema === NEED_SCHEMA.name) {
		const bundle = readJsonBlock<CompanyBundle>(lastUserText(input))
		return bundle && JSON.stringify({ needs: bundle.challenges.map(mockNeed) } satisfies NeedAnswer)
	}
	if (schema === NEED_FIX_SCHEMA.name) {
		const data = readJsonBlock<NeedFixInput>(lastUserText(input))
		const fixes: ClaimFix[] = (data?.rejected ?? []).map((_, index) => ({ index, action: "drop", text: "", sourceIds: [] }))
		return data && JSON.stringify({ fixes })
	}
	return undefined
}

const NOT_RESEARCH = /series a|venture|investor|funding round|\bhir(e|ing)\b|recruit|on leave|licen[cs]e|permit|gdpr|sales team|zaposli/i
const SERVICE = /\bsap\b|\berp\b|integrat|dashboard|migrat/i
const ASSET = /\b(data|dataset|archive|captures|measurements|samples|lab|bench|line|engineers?|team|budget|records)\b/i
const CONSTRAINT = /\b(must|cannot|can't|deadline|regulat|without|only|by the end|before|limit)/i

function mockNeed(ch: CompanyBundle["challenges"][number]): NeedDraft {
	const triage: ChallengeTriage = NOT_RESEARCH.test(ch.text) ? "not-research" : SERVICE.test(ch.text) ? "engineering-service" : "research"
	const claimsOf = (pattern: RegExp): Claim[] =>
		sentences(ch.detail)
			.filter((s) => s.length < 300 && pattern.test(s))
			.slice(0, 2)
			.map((text) => ({ text, sourceIds: [ch.id] }))
	return {
		challengeId: ch.id,
		triage,
		triageReason: `Mock triage by keywords: ${triage}.`,
		restatement: { text: firstSentence(ch.text), sourceIds: [ch.id] },
		searchTerms: triage === "not-research" ? [] : topWords(`${ch.text} ${ch.detail}`, 7),
		assets: claimsOf(ASSET),
		constraints: claimsOf(CONSTRAINT),
	}
}

const STOP = new Set(
	`about after again against also because before being below between could doesn during every first found have having
	into itself might never other their there these those through under until using where which while would years months
	weeks currently already another without within should cannot client clients customer customers company product products
	we our they them this that with from your what when need needs want wants like just more most some such than then`.split(/\s+/),
)

/** The most frequent content words, as crude search terms. */
function topWords(text: string, n: number): string[] {
	const counts = new Map<string, number>()
	for (const word of fold(text).split(/[^a-z0-9]+/)) {
		if (word.length < 5 || STOP.has(word) || /^\d+$/.test(word)) continue
		counts.set(word, (counts.get(word) ?? 0) + 1)
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([word]) => word)
}
