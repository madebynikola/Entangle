import type { StructuredOutputFormat } from "@mozaik-ai/core"
import type { Decision, DecisionQuestion } from "../../runtime"
import type { ArtifactKind, Claim, RejectedClaim, SourceRecord } from "../../types"
import type { Subject } from "./checks"
import { clip } from "./text"

export const CRITIC_INSTRUCTION = `You are the Critic in a team of agents that pairs university researchers with company challenges.
Other agents write claims. You check each claim against the dataset records it cites. You never add facts.

A claim is supported when every fact in it (topic, skill, method, result, number, year, role, product, tie) is stated in,
or follows directly from, the text of the records it cites.

A claim is not supported when:
- it names a paper, project, patent, skill, number or tie that the cited text does not contain;
- it says more than the text: a stronger result, a wider scope, another year or another role;
- it widens a list or a count ("all three clients ask for monthly tests" when one asked), or merges two separate points of
  a record into one ("clinical validation under MDR" when the record covers each apart);
- it adds a judgement on how a record fits the other side ("directly addresses the company's false-positive problem",
  "matching the structured output requirement", "the core engine for change detection"). A record about the researcher
  says nothing about the company, so such words are not in it;
- it takes a word from a record it does not cite. Judge only the cited text, even when you know the fact is true elsewhere;
- it gives a record to a person the record does not link. Go by ids, never by names;
- it says that two researchers worked together and no cited record links both;
- it gives a private reason for availability (family, parental leave, health). Only the availability fact may be stated;
- it names a researcher who cannot lead (emeritus, departed, on leave) as principal investigator or supervisor.

Read every qualifier as a fact: "paid", "licensed", "all", "unsupervised", "real-world", "led", "data partner" each must be
in the cited text. A claim about what the pair could do together is supported when the skills and needs it rests on are in
the cited text, and it cites records of both sides.
Judge only what a claim states. A claim may leave out details of the text (a date, a count, a side remark) and still be
supported: reject what it adds or changes, never what it omits. If the text states the claim, mark it supported.
Answer for every claim, by its number. Keep each reason to one sentence and name the source id it rests on.`

/**
 * The rubric for a proposal's free text, sent with it. Free text holds proposals and reasoning; it fails only where it
 * states as true what no claim or source states. The hand-check of three proposals on 30 Oct found 20 such sentences
 * (an invented recording set, equipment the device does not have, "the researcher has no access to real traffic").
 */
const TEXT_RULES = `The sentences followed by [ids] are claims; they are checked one by one elsewhere. Here, check only the other text:
the research questions, approach, plan, first steps, the reasoning under "Why this pair" and the terms agreed up front.

Free text may propose new work and new data ("collect", "label", "set up", "measure", "aim for"), and may reason from the
claims. List a sentence only when it:
- presents as already true a fact about the company or the researcher (data, recordings, a dataset size, history,
  equipment, staff, a skill, what a method does, a past result) that neither the claims nor the sources state;
- says what a side lacks or cannot do, and the claims and sources do not say so, or say the opposite;
- contradicts a claim or a source;
- plans work that breaks a limit the company states (a rate it may not go below, hardware it cannot change).
Quote each such sentence whole, exactly as written. Give one reason per sentence and name the claim or source it rests on.
Return an empty list when the free text is fine.`

export const TEXT_REVIEW_SCHEMA: StructuredOutputFormat = {
	name: "critic_text_review",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["statements"],
		properties: {
			statements: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["quote", "reason"],
					properties: {
						quote: { type: "string", description: "The whole sentence, copied exactly from the free text." },
						reason: { type: "string", description: "What the claims and sources say instead, in one sentence." },
					},
				},
			},
		},
	},
}

export const REVIEW_SCHEMA: StructuredOutputFormat = {
	name: "critic_review",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["checks"],
		properties: {
			checks: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					// The reason comes before the verdict, so the model weighs the text before it decides.
					required: ["claim", "reason", "supported"],
					properties: {
						claim: { type: "integer", description: "The claim number." },
						reason: { type: "string", description: "What the cited text says about the claim, in one sentence." },
						supported: { type: "boolean", description: "True when the reason finds every fact of the claim in the cited text." },
					},
				},
			},
		},
	},
}

export interface ReviewCheck {
	claim: number
	supported: boolean
	reason: string
}

/**
 * Chars of all sources' text in one prompt. Records are shown whole: a researcher's availability and a
 * company's R&D capacity sit at the end of the longest ones (up to ~3,700 chars), and a cut there makes the
 * Critic reject true claims. Only a review that cites more than this cuts, and then the longest records first.
 */
const TOTAL_CHARS = 100_000

export function reviewMessage(
	kind: ArtifactKind,
	id: string,
	subject: Subject,
	claims: Claim[],
	sources: Map<string, SourceRecord>,
	totalChars = TOTAL_CHARS,
): string {
	const claimLines = claims.map((claim, i) => `${i + 1}. ${claim.text} [${claim.sourceIds.join(", ")}]`)
	return [
		`Review the claims of ${kind} ${id}.`,
		`It is about: ${subject.line}.`,
		"",
		"Claims:",
		...claimLines,
		"",
		"Sources:",
		sourceBlocks(sources, totalChars),
	].join("\n")
}

/** The free-text check of a proposal: its text without the Sources list, every record it cites, and the rubric. */
export function textReviewMessage(
	id: string,
	subject: Subject,
	text: string,
	sources: Map<string, SourceRecord>,
	totalChars = TOTAL_CHARS,
): string {
	return [
		`Review the free text of proposal ${id}.`,
		`It is about: ${subject.line}.`,
		"",
		TEXT_RULES,
		"",
		"Proposal:",
		text,
		"",
		"Sources:",
		sourceBlocks(sources, totalChars),
	].join("\n")
}

function sourceBlocks(sources: Map<string, SourceRecord>, totalChars: number): string {
	const records = [...sources]
	const room = shares(
		records.map(([, record]) => record.text.length),
		totalChars,
	)
	return records
		.map(([cited, record], i) => {
			const alias = cited === record.id ? "" : ` (cited as ${cited})`
			const linked = record.researcherIds.length ? ` · researchers ${record.researcherIds.join(", ")}` : ""
			const company = record.companyId ? ` · company ${record.companyId}` : ""
			const year = record.year ? ` · ${record.year}` : ""
			return `[${record.id}]${alias} ${record.kind} · ${record.title}${year}${linked}${company}\n${clip(record.text, room[i])}`
		})
		.join("\n\n")
}

/** Split `total` chars over texts of these lengths: the shortest whole, the rest share what is left evenly. */
function shares(lengths: number[], total: number): number[] {
	const room = new Array<number>(lengths.length)
	let left = total
	const order = lengths.map((_, i) => i).sort((a, b) => lengths[a] - lengths[b])
	order.forEach((i, n) => {
		room[i] = Math.min(lengths[i], Math.floor(left / (order.length - n)))
		left -= room[i]
	})
	return room
}

/**
 * Turn the model's answer into rejected claims. A claim the answer skips is rejected as `unchecked`.
 * Throws when the answer is not the review JSON.
 */
export function parseReview(output: string | undefined, claims: Claim[]): RejectedClaim[] {
	const parsed = JSON.parse(output ?? "") as { checks?: ReviewCheck[] }
	if (!Array.isArray(parsed.checks)) throw new Error("The review has no checks")
	const byNumber = new Map(parsed.checks.map((check) => [check.claim, check]))
	const rejected: RejectedClaim[] = []
	claims.forEach((claim, i) => {
		const check = byNumber.get(i + 1)
		if (!check) rejected.push({ claim, reason: "The review gave no answer for this claim.", check: "unchecked" })
		else if (!check.supported) rejected.push({ claim, reason: check.reason, check: "unsupported" })
	})
	return rejected
}

/**
 * Turn the model's free-text answer into rejected items: each quoted sentence is a `free-text` reject whose claim text
 * is the quote, with no sources. Throws when the answer is not the text-review JSON.
 */
export function parseTextReview(output: string | undefined): RejectedClaim[] {
	const parsed = JSON.parse(output ?? "") as { statements?: Array<{ quote?: string; reason?: string }> }
	if (!Array.isArray(parsed.statements)) throw new Error("The text review has no statements")
	const quotes = new Set<string>()
	return parsed.statements.flatMap(({ quote, reason }) => {
		const text = quote?.trim()
		if (!text || quotes.has(text)) return []
		quotes.add(text)
		return [{ claim: { text, sourceIds: [] }, reason: reason?.trim() || "No claim or source states it.", check: "free-text" as const }]
	})
}

const SUPPORTED =
	"Every fact in the claim (topic, skill, method, result, number, year, role, product, tie) is stated in, or follows " +
	"directly from, the text of the records it cites. Leaving out details of the text is fine."
const NOT_SUPPORTED =
	"The claim adds or changes a fact the cited text does not state (a paper, number, tie, stronger result, wider scope, " +
	"other year or role), gives a record to a person it does not link, says two researchers worked together with no record " +
	"linking both, gives a private reason for availability, or names someone who cannot lead as principal investigator."

/**
 * The review as typed questions for a decision model (subq-snap, Jev): one yes/no question per claim, all against
 * the review message. These models write no reasons, so a rejected claim's reason gives the probability instead.
 */
export function reviewDecision(message: string, claims: Claim[], threshold: number): Decision {
	const name = (i: number) => `claim_${i + 1}`
	const questions: Record<string, DecisionQuestion> = {}
	claims.forEach((claim, i) => {
		questions[name(i)] = {
			type: "noul",
			instructions: `Is claim ${i + 1} supported by the text of the records it cites (${claim.sourceIds.join(", ")})? The claim: ${claim.text}`,
			criteria: { true: SUPPORTED, false: NOT_SUPPORTED },
		}
	})
	return {
		state: message,
		questions,
		answer(answers) {
			const checks: ReviewCheck[] = []
			claims.forEach((_, i) => {
				const yes = answers[name(i)]?.noul
				if (typeof yes !== "number") return
				const supported = yes >= threshold
				const reason = `${Math.round(yes * 100)}% likely that the cited text supports it.`
				checks.push({ claim: i + 1, reason, supported })
			})
			return JSON.stringify({ checks })
		},
	}
}
