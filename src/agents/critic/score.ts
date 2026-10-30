import type { Claim, SourceRecord } from "../../types"

/**
 * The label a person gave a claim after reading the records it cites (test/fixtures/critic-labels.json).
 * `judgement`, `uncited-detail` and `widened` are wrong claims the Critic should reject; `ok` it should pass;
 * `borderline` counts neither way.
 */
export type ClaimLabel = "ok" | "judgement" | "uncited-detail" | "widened" | "borderline"

export const CLAIM_LABELS: ClaimLabel[] = ["ok", "judgement", "uncited-detail", "widened", "borderline"]
const BAD = new Set<ClaimLabel>(["judgement", "uncited-detail", "widened"])

export interface LabelledClaim extends Claim {
	/** The claim's number in its proposal, from 1. */
	n: number
	label: ClaimLabel
	/** Why the label, in one sentence. */
	note?: string
}

export interface LabelledProposal {
	id: string
	pairId: string
	/** The run the proposal comes from. */
	run: string
	phase: string
	claims: LabelledClaim[]
}

export interface CriticLabels {
	about: string
	labels: Record<ClaimLabel, string>
	proposals: LabelledProposal[]
	/** Every record the claims cite, and each pair's researcher, company and challenge. */
	records: Record<string, SourceRecord>
}

/** One labelled claim after a Critic review: who rejected it (a reviewer's name, or `code`) and why. */
export interface ReviewedClaim extends LabelledClaim {
	proposalId: string
	phase: string
	rejectedBy: string[]
	reason?: string
}

export interface CriticScore {
	/** Claims labelled judgement, uncited-detail or widened, and how many of them were rejected. */
	bad: number
	caught: number
	/** caught / bad. */
	recall: number
	/** Claims labelled ok, and how many of them were rejected. */
	good: number
	falseRejects: number
	/** falseRejects / good. */
	falseRejectRate: number
	/** Per label: claims, and how many were rejected. */
	byLabel: Record<ClaimLabel, { claims: number; rejected: number }>
	/** Wrong claims passed. */
	missed: ReviewedClaim[]
	/** Ok claims rejected. */
	falselyRejected: ReviewedClaim[]
}

/** Score a review of the labelled claims. With `reviewer`, only that reviewer's rejections count; else anyone's. */
export function scoreCritic(claims: ReviewedClaim[], reviewer?: string): CriticScore {
	const rejected = (claim: ReviewedClaim) => (reviewer ? claim.rejectedBy.includes(reviewer) : claim.rejectedBy.length > 0)
	const byLabel = Object.fromEntries(CLAIM_LABELS.map((label) => [label, { claims: 0, rejected: 0 }])) as CriticScore["byLabel"]
	const missed: ReviewedClaim[] = []
	const falselyRejected: ReviewedClaim[] = []
	for (const claim of claims) {
		const row = byLabel[claim.label]
		row.claims++
		if (rejected(claim)) row.rejected++
		if (BAD.has(claim.label) && !rejected(claim)) missed.push(claim)
		if (claim.label === "ok" && rejected(claim)) falselyRejected.push(claim)
	}
	const bad = claims.filter((claim) => BAD.has(claim.label)).length
	const good = byLabel.ok.claims
	return {
		bad,
		caught: bad - missed.length,
		recall: bad ? (bad - missed.length) / bad : 0,
		good,
		falseRejects: falselyRejected.length,
		falseRejectRate: good ? falselyRejected.length / good : 0,
		byLabel,
		missed,
		falselyRejected,
	}
}

const percent = (share: number) => `${Math.round(share * 100)}%`

/** The score as plain text: the two rates, the confusion matrix by label, then each miss and false reject. */
export function formatScore(score: CriticScore, title: string): string {
	const rows = CLAIM_LABELS.map((label) => {
		const { claims, rejected } = score.byLabel[label]
		return `  ${label.padEnd(15)}${String(claims).padStart(7)}${String(rejected).padStart(10)}${String(claims - rejected).padStart(8)}`
	})
	const line = (claim: ReviewedClaim) => `  ${claim.proposalId} #${claim.n} (${claim.label}): ${claim.text}`
	return [
		title,
		`  Caught ${score.caught} of ${score.bad} wrong claims (recall ${percent(score.recall)}).`,
		`  Rejected ${score.falseRejects} of ${score.good} ok claims (false rejects ${percent(score.falseRejectRate)}).`,
		"",
		`  ${"label".padEnd(15)}${"claims".padStart(7)}${"rejected".padStart(10)}${"passed".padStart(8)}`,
		...rows,
		...(score.missed.length ? ["", "  Missed:", ...score.missed.map(line)] : []),
		...(score.falselyRejected.length
			? ["", "  Rejected but ok:", ...score.falselyRejected.flatMap((claim) => [line(claim), `    Critic: ${claim.reason ?? ""}`])]
			: []),
	].join("\n")
}
