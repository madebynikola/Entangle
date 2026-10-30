import type { Claim, SourceRecord } from "../../types"
import type { ReviewCheck } from "./prompt"
import { IDS_IN_TEXT, fold } from "./text"

const STOP_WORDS = new Set(
	`about above after also among and are based been being both but can could does each from has have having her his
	into its many more most much not now only other our over own same she should some such than that the their them
	then there these they this those through under upon very was were what when where which while who will with within
	would work works worked working uses using used use including include includes researcher researchers research
	company companies team year years has had several various`.split(/\s+/),
)

/** Content-word stems: folded, at least 4 letters, no plural s, cut to 5 chars, so "allocation" and "allocating" meet. */
function stems(text: string): Map<string, string> {
	const out = new Map<string, string>()
	for (const word of fold(text).split(/[^a-z0-9]+/)) {
		if (word.length < 4 || STOP_WORDS.has(word) || /\d/.test(word)) continue
		const stem = word.replace(/(?<=.{4})s$/, "").slice(0, 5)
		if (!out.has(stem)) out.set(stem, word)
	}
	return out
}

/**
 * The model check's stand-in for mock runs: a claim is supported when at least `threshold`
 * of its content words appear in the records it cites (or in the subject line, for names).
 * Crude, but it catches an invented paper, skill or patent, so the review loop runs with no keys.
 */
export function lexicalReview(
	claims: Claim[],
	sources: Map<string, SourceRecord>,
	subjectLine: string,
	threshold = 0.6,
): ReviewCheck[] {
	return claims.map((claim, i) => {
		const vocabulary = new Set(
			claim.sourceIds.flatMap((id) => {
				const record = sources.get(id)
				return record ? [...stems(`${record.title} ${record.text}`).keys()] : []
			}),
		)
		for (const stem of stems(subjectLine).keys()) vocabulary.add(stem)
		const words = stems(claim.text)
		const missing = [...words].filter(([stem]) => !vocabulary.has(stem)).map(([, word]) => word)
		const coverage = words.size ? 1 - missing.length / words.size : 1
		const supported = coverage >= threshold
		const reason = supported
			? `Most of the claim is in ${claim.sourceIds.join(", ")}.`
			: `${claim.sourceIds.join(", ")} ${claim.sourceIds.length > 1 ? "do" : "does"} not mention: ${missing.slice(0, 6).join(", ")}.`
		return { claim: i + 1, supported, reason }
	})
}

/**
 * The second reviewer's stand-in for mock runs, stricter than lexicalReview the way another model would be:
 * it wants 80% of the claim's words in the cited records, not 60%, and every number in the claim (a year,
 * a share, a count) written there. So the two disagree on loosely worded claims and on invented figures,
 * which lexicalReview skips.
 */
export function strictReview(claims: Claim[], sources: Map<string, SourceRecord>, subjectLine: string): ReviewCheck[] {
	return lexicalReview(claims, sources, subjectLine, 0.8).map((check, i) => {
		if (!check.supported) return check
		const claim = claims[i]
		const cited = claim.sourceIds.flatMap((id) => {
			const record = sources.get(id)
			return record ? [`${record.title} ${record.year ?? ""} ${record.text}`] : []
		})
		const text = [...cited, subjectLine].join(" ")
		const numbers = claim.text.replace(IDS_IN_TEXT, " ").match(/\b\d+(?:[.,]\d+)?\b/g) ?? []
		const missing = [...new Set(numbers)].filter((n) => !text.includes(n))
		if (!missing.length) return check
		const verb = claim.sourceIds.length > 1 ? "do" : "does"
		return { claim: i + 1, supported: false, reason: `${claim.sourceIds.join(", ")} ${verb} not state ${missing.join(", ")}.` }
	})
}
