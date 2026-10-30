import type { RunResults } from "@shared/server/api"
import type { ArtifactKind, Claim, CompanyNeed, CriticVerdict, NoMatch, PairCandidate, Proposal, ResearcherProfile, TraceRecord } from "@shared/types"
import { useMemo } from "react"
import { useParams } from "react-router"
import { useResults } from "@/run/hooks"

/**
 * Lookups over one run's results, built once per results object.
 * Everything joins on dataset ids (`C002-CH1`, `R0322`), never on names.
 */

export interface Company {
	id: string
	name: string
	sector: string
}

/**
 * A proposal the Critics did not accept: they still rejected it after its last fix, or the fix could not run.
 * It is not among the accepted proposals. A person reads the draft and decides.
 */
export interface HeldBack {
	id: string
	pairId: string
	/** The full draft, when the run stored it. */
	draft?: Proposal
	/** The latest Critic verdict on it, if a review ran. */
	verdict?: CriticVerdict
}

export interface ResultsIndex {
	results: RunResults
	needs: Map<string, CompanyNeed>
	companies: Map<string, Company>
	/** By canonical id and by every alias. */
	profiles: Map<string, ResearcherProfile>
	pairs: Map<string, PairCandidate>
	proposals: Map<string, Proposal>
	proposalByPair: Map<string, Proposal>
	noMatches: Map<string, NoMatch>
	/** Every challenge the run looked at: from needs, pairs and no-match outcomes, in dataset order. */
	challengeIds: string[]
	/** Pairs of each challenge, best fit first. Fit compares pairs within one challenge only. */
	pairsByChallenge: Map<string, PairCandidate[]>
	heldBack: HeldBack[]
	heldBackByPair: Map<string, HeldBack>
	/** Pair ids handed to the Writers. Null when the run did not record them. */
	chosen: Set<string> | null
}

export function buildIndex(results: RunResults): ResultsIndex {
	const needs = new Map(results.needs.map((need) => [need.challengeId, need]))
	const companies = new Map<string, Company>()
	for (const need of results.needs) {
		if (!companies.has(need.companyId)) companies.set(need.companyId, { id: need.companyId, name: need.companyName, sector: need.sector })
	}
	const profiles = new Map<string, ResearcherProfile>()
	for (const profile of results.profiles) {
		profiles.set(profile.researcherId, profile)
		for (const alias of profile.aliases) profiles.set(alias, profile)
	}
	const pairs = new Map(results.pairs.map((pair) => [pair.id, pair]))
	const proposals = new Map(results.proposals.map((proposal) => [proposal.id, proposal]))
	const proposalByPair = new Map(results.proposals.map((proposal) => [proposal.pairId || pairIdOf(proposal.id), proposal]))
	const noMatches = new Map(results.noMatches.map((none) => [none.challengeId, none]))

	const pairsByChallenge = new Map<string, PairCandidate[]>()
	for (const pair of results.pairs) pairsByChallenge.set(pair.challengeId, [...(pairsByChallenge.get(pair.challengeId) ?? []), pair])
	for (const list of pairsByChallenge.values()) list.sort((a, b) => b.fit - a.fit)

	const challengeIds = [...new Set([...needs.keys(), ...pairsByChallenge.keys(), ...noMatches.keys()])].sort(byDatasetId)

	// Held back: every stored draft that was not accepted, then any proposal whose latest verdict asks for a person.
	const latest = new Map<string, CriticVerdict>()
	for (const verdict of results.verdicts) if (kindOf(verdict) === "proposal") latest.set(verdict.proposalId, verdict)
	const held = new Map<string, HeldBack>()
	for (const draft of results.needsHuman ?? []) {
		if (!proposals.has(draft.id)) held.set(draft.id, { id: draft.id, pairId: draft.pairId || pairIdOf(draft.id), draft, verdict: latest.get(draft.id) })
	}
	for (const verdict of latest.values()) {
		const id = verdict.proposalId
		if (verdict.action === "human-review" && !proposals.has(id) && !held.has(id)) held.set(id, { id, pairId: pairIdOf(id), verdict })
	}
	const heldBack = [...held.values()]
	const heldBackByPair = new Map(heldBack.map((item) => [item.pairId, item]))
	const chosen = results.chosen ? new Set(results.chosen) : null

	return {
		results,
		needs,
		companies,
		profiles,
		pairs,
		proposals,
		proposalByPair,
		noMatches,
		challengeIds,
		pairsByChallenge,
		heldBack,
		heldBackByPair,
		chosen,
	}
}

/** The open run's results with their lookups, or null while loading. */
export function useResultsIndex() {
	const { results, error, runId } = useResults()
	const index = useMemo(() => (results ? buildIndex(results) : null), [results])
	return { index, error, runId }
}

/** Absolute paths inside the results tab, so links work from any nested route. */
export function useResultsPath() {
	const { runId = "" } = useParams()
	const base = `/runs/${encodeURIComponent(runId)}/results`
	return {
		base,
		pairs: `${base}/pairs`,
		pair: (pairId: string) => `${base}/pairs/${encodeURIComponent(pairId)}`,
		proposal: (proposalId: string) => `${base}/proposals/${encodeURIComponent(proposalId)}`,
	}
}

// ---------------------------------------------------------------------------
// Names and labels
// ---------------------------------------------------------------------------

export function companyOf(index: ResultsIndex, companyId: string): Company {
	return index.companies.get(companyId) ?? { id: companyId, name: companyId, sector: "" }
}

export function researcherName(index: ResultsIndex, researcherId: string): string {
	return index.profiles.get(researcherId)?.name ?? researcherId
}

/** `C001-CH1` from `C001-CH1:R0416` or `C001-CH1-R0416`. */
export function challengeIdOf(id: string): string {
	return id.match(/^(C\d+-CH\d+)/)?.[1] ?? id
}

/** The pair id behind a proposal id: `C001-CH1-R0416` → `C001-CH1:R0416`. */
export function pairIdOf(proposalId: string): string {
	return proposalId.replace(/^(C\d+-CH\d+)-(R\d+)$/, "$1:$2")
}

/** The proposal id a Writer gives a pair: `C001-CH1:R0416` → `C001-CH1-R0416`. */
export function proposalIdOf(pairId: string): string {
	return pairId.replace(":", "-")
}

export function researcherIdOf(pairId: string): string {
	return pairId.match(/(R\d+)$/)?.[1] ?? pairId
}

/** The proposal's Markdown without its first heading when that heading repeats the title shown above it. */
export function stripTitle(markdown: string, title: string): string {
	return markdown.replace(/^\s*#{1,3}\s+(.+)\n+/, (line, heading: string) => {
		const a = heading.trim().toLowerCase()
		const b = title.trim().toLowerCase()
		return a === b || b.startsWith(a) || a.startsWith(b) ? "" : line
	})
}

export function kindLabel(kind: Proposal["kind"]): string {
	return kind === "industrial-phd" ? "Industrial PhD" : "Joint project"
}

/** `claude-sonnet-4-6` → `Sonnet 4.6`. */
export function modelLabel(model: string): string {
	const match = model.match(/claude-([a-z]+)-(\d+)-(\d+)/i)
	return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}` : model
}

export const TRIAGE_LABEL = {
	research: "Research problem",
	"engineering-service": "Engineering service",
	"not-research": "Not a research problem",
} as const

/**
 * Why a challenge has no pair. "No good match" only when the Matchmaker said so; otherwise the plain fact,
 * with the Analyst's triage when it was not a research problem.
 */
export function noPair(index: ResultsIndex, challengeId: string): { label: string; reason: string } {
	const none = index.noMatches.get(challengeId)
	if (none) return { label: "No good match", reason: none.reason }
	const need = index.needs.get(challengeId)
	if (need && need.triage !== "research") return { label: "No pair", reason: `${TRIAGE_LABEL[need.triage]}: ${need.triageReason}` }
	return { label: "No pair", reason: "The Matchmaker proposed no pair for this challenge." }
}

/**
 * What became of a pair after matching. `not-written`: it was chosen, but no proposal and no draft came back.
 * `unknown`: the run did not record which pairs were chosen.
 */
export type PairOutcome =
	| { kind: "proposal"; proposal: Proposal }
	| { kind: "held-back"; held: HeldBack }
	| { kind: "not-written" }
	| { kind: "not-chosen" }
	| { kind: "unknown" }

export function pairOutcome(index: ResultsIndex, pairId: string): PairOutcome {
	const proposal = index.proposalByPair.get(pairId)
	if (proposal) return { kind: "proposal", proposal }
	const held = index.heldBackByPair.get(pairId)
	if (held) return { kind: "held-back", held }
	if (!index.chosen) return { kind: "unknown" }
	return index.chosen.has(pairId) ? { kind: "not-written" } : { kind: "not-chosen" }
}

/**
 * Why a proposal was not written: the error of the last write task for it that failed, from the trace.
 * The first draft's task is named in `orchestrator.assigned`, each fix's task in `critic.sent_back`.
 */
export function writeFailure(records: TraceRecord[], proposalId: string): string | undefined {
	const tasks = new Set<string>()
	let error: string | undefined
	for (const record of records) {
		const data = record.data as { taskId?: string; subjectId?: string; id?: string; error?: string } | undefined
		if (!data?.taskId) continue
		if ((record.kind === "orchestrator.assigned" && data.subjectId === proposalId) || (record.kind === "critic.sent_back" && data.id === proposalId)) {
			tasks.add(data.taskId)
		} else if (tasks.has(data.taskId)) {
			if (record.kind === "task.failed") error = data.error ?? "failed"
			else if (record.kind === "task.completed") error = undefined
		}
	}
	return error
}

/** A task error in a few words: the budget limit it hit (see budgetExceeded in src/runtime/state.ts), or that it failed. */
export function failureLabel(error: string): string {
	if (/^(tokens|cost) /.test(error)) return "budget"
	if (error.startsWith("wall clock")) return "time limit"
	if (error.startsWith("attempts")) return "attempts used"
	return "task failed"
}

/** Dataset order: C001-CH2 before C001-CH10, R0099 before R0100. */
export function byDatasetId(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true })
}

// ---------------------------------------------------------------------------
// Critic reviews
// ---------------------------------------------------------------------------

export function kindOf(verdict: CriticVerdict): ArtifactKind {
	return verdict.kind ?? "proposal"
}

/** Every review of one artifact, oldest first. */
export function reviewsOf(results: RunResults, kind: ArtifactKind, id: string): CriticVerdict[] {
	return results.verdicts.filter((verdict) => kindOf(verdict) === kind && verdict.proposalId === id)
}

export type ReviewTone = "working" | "needs" | "failed" | "idle"

/** Where an artifact's review ended, in words. */
export function reviewSummary(verdicts: CriticVerdict[]): { tone: ReviewTone; label: string } {
	const last = verdicts.at(-1)
	if (!last) return { tone: "idle", label: "Not reviewed" }
	const fixes = verdicts.filter((verdict) => !verdict.ok).length
	if (last.ok) return { tone: "working", label: fixes ? `Passed review after ${fixes === 1 ? "1 fix" : `${fixes} fixes`}` : "Passed review" }
	if (last.action === "human-review") return { tone: "needs", label: "Needs human review" }
	if (last.action === "drop") return { tone: "failed", label: "Dropped by the Critic" }
	return { tone: "needs", label: "Sent back for a fix" }
}

export const CHECK_LABEL: Record<NonNullable<CriticVerdict["rejected"][number]["check"]>, string> = {
	"no-source": "No source",
	"unknown-source": "Unknown source id",
	"wrong-subject": "Source is about someone else",
	"name-mismatch": "Name does not match the id",
	unsupported: "Source does not support it",
	unchecked: "Not checked",
}

export type Fix = { kind: "kept" | "new-sources" | "rewritten"; claim: Claim } | { kind: "removed" }

const STOP = new Set(
	"the a an and or of to in on for with by at from as is are was were be been has have had its it this that these those which who whose but not no very than then their there into over under per can could would should will about also only".split(
		" ",
	),
)

function words(text: string): Set<string> {
	const out = new Set<string>()
	for (const word of text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
		if (STOP.has(word)) continue
		out.add(word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word)
	}
	return out
}

/**
 * What became of a rejected claim in the final version: kept, given other sources, rewritten or taken out.
 * Matches on shared words, and asks for more overlap when the two claims share no source.
 */
export function findFix(rejected: Claim, final: Claim[]): Fix {
	const exact = final.find((claim) => claim.text.trim() === rejected.text.trim())
	if (exact) {
		const same = exact.sourceIds.length === rejected.sourceIds.length && exact.sourceIds.every((id) => rejected.sourceIds.includes(id))
		return { kind: same ? "kept" : "new-sources", claim: exact }
	}
	const mine = words(rejected.text)
	let best: { claim: Claim; score: number } | null = null
	for (const claim of final) {
		const theirs = words(claim.text)
		let both = 0
		for (const word of mine) if (theirs.has(word)) both++
		const score = both / Math.max(1, Math.min(mine.size, theirs.size))
		const shared = claim.sourceIds.some((id) => rejected.sourceIds.includes(id))
		if (score >= (shared ? 0.5 : 0.65) && (!best || score > best.score)) best = { claim, score }
	}
	return best ? { kind: "rewritten", claim: best.claim } : { kind: "removed" }
}

/** The claims a pair rests on, in reading order. */
export function pairClaims(pair: PairCandidate): Claim[] {
	return [pair.problem, ...pair.why, ...pair.risks]
}
