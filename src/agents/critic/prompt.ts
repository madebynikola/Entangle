import type { StructuredOutputFormat } from "@mozaik-ai/core"
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
- it gives a record to a person the record does not link. Go by ids, never by names;
- it says that two researchers worked together and no cited record links both;
- it gives a private reason for availability (family, parental leave, health). Only the availability fact may be stated;
- it names a researcher who cannot lead (emeritus, departed, on leave) as principal investigator or supervisor.

A claim about what the pair could do together is supported when the skills and needs it rests on are in the cited text.
Judge only what a claim states. A claim may leave out details of the text (a date, a count, a side remark) and still be
supported: reject what it adds or changes, never what it omits. If the text states the claim, mark it supported.
Answer for every claim, by its number. Keep each reason to one sentence and name the source id it rests on.`

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
					required: ["claim", "supported", "reason"],
					properties: {
						claim: { type: "integer", description: "The claim number." },
						supported: { type: "boolean" },
						reason: { type: "string" },
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
	const records = [...sources]
	const room = shares(
		records.map(([, record]) => record.text.length),
		totalChars,
	)
	const claimLines = claims.map((claim, i) => `${i + 1}. ${claim.text} [${claim.sourceIds.join(", ")}]`)
	const sourceBlocks = records.map(([cited, record], i) => {
		const alias = cited === record.id ? "" : ` (cited as ${cited})`
		const linked = record.researcherIds.length ? ` · researchers ${record.researcherIds.join(", ")}` : ""
		const company = record.companyId ? ` · company ${record.companyId}` : ""
		const year = record.year ? ` · ${record.year}` : ""
		return `[${record.id}]${alias} ${record.kind} · ${record.title}${year}${linked}${company}\n${clip(record.text, room[i])}`
	})
	return [
		`Review the claims of ${kind} ${id}.`,
		`It is about: ${subject.line}.`,
		"",
		"Claims:",
		...claimLines,
		"",
		"Sources:",
		sourceBlocks.join("\n\n"),
	].join("\n")
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
