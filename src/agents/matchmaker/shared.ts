import { SemanticEvent, SituationSpecification, type SituationContext } from "@mozaik-ai/core"
import { resolveRuntime, sendEvent, type MockResponder } from "../../runtime"
import type { Claim, RejectedClaim } from "../../types"

/** Helpers the Matchmaker and the Writer share. Review events come from src/agents/critic/protocol.ts. */

/** How a claim must read so the Critic can confirm it against its source. Shared by the Matchmaker and the Writer prompts. */
export const CLAIM_RULES = `How to write a claim, so a reviewer finds it in the cited record:
- Say what the cited record says, at the same scope, and no more. "co-authored a paper on one-class SVMs for DNP3 command sequences in water treatment", not "used one-class SVMs for control systems". Your reasoning is not a claim.
- A claim states facts only, never how well they fit. A record about the researcher says nothing about the company, so "directly addresses the company's false-positive problem", "matching the structured output requirement" or "the core engine for change detection" is not in it. That judgement goes in your reasoning.
- Every word must come from a record the claim cites. If a detail ("paid", "Nordic", "data partner", "led") is only in the researcher's profile or a job page, cite that id too, or leave the detail out. Do not merge two separate points of a record into one ("clinical validation under MDR" when the record covers clinical validation and, apart from it, MDR classification).
- Do not widen a list or a count: "asked for a retest after patches; one asked for monthly checks", not "all three ask for monthly testing". Write "all" or "every" only when the record does.
- Give the researcher's role as the record gives it: "co-authored" for a paper with other authors, "led" only for a principal investigator or coordinator, "took part in" for other project roles.
- Keep the company's own hedges: if it suspects a cause, write that it suspects it. Add no requirement or label the record does not give.
- Never write a claim that guesses ("may", "might", "probably") or says what a record lacks. State a gap as the scope of what the record covers: "the paper covers Modbus traffic", not "there is no BACnet work". Gaps and guesses belong in your reasoning.
- Facts come only from claims and records in the input. A triage reason or a search term is someone's judgement, not a fact.
- Refer to a researcher by name or as "the researcher". Never write he, she, his or her: the data gives no one's gender.
- A claim about availability copies the profile's availability claim. Never add availability facts the profile does not give.`

export class EventOfType extends SituationSpecification {
	constructor(private readonly type: string) {
		super()
	}

	isSatisfiedBy({ event }: SituationContext): boolean {
		return event.type === this.type
	}
}

export function emit(agentId: string, type: string, payload: Record<string, unknown>): void {
	sendEvent(SemanticEvent.create(type, agentId, payload), agentId)
}

/** Parse a model answer as JSON. Tolerates a ```json fence around it. */
export function parseJson<T>(text: string | undefined): T {
	if (!text) throw new Error("empty answer")
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
	return JSON.parse((fenced ? fenced[1] : text).trim()) as T
}

/** Embed input data in a prompt so the model, and the mock responders, can read it back. */
export function jsonBlock(value: unknown): string {
	return "```json\n" + JSON.stringify(value, null, 1) + "\n```"
}

/** The first ```json block of a prompt, for mock responders. */
export function readJsonBlock<T>(text: string): T | undefined {
	const match = text.match(/```json\n([\s\S]*?)\n```/)
	return match ? (JSON.parse(match[1]) as T) : undefined
}

/**
 * Give the mock runner a canned answer for this agent. Works when the runtime's runner is the
 * MockInferenceRunner, or a wrapper that exposes its `responders` (or an `inner` runner that does).
 */
export function registerMockResponder(responder: MockResponder): boolean {
	let runner = resolveRuntime().getInferenceRunner() as unknown as { responders?: MockResponder[]; inner?: unknown }
	for (let depth = 0; runner && depth < 3; depth++) {
		if (Array.isArray(runner.responders)) {
			if (!runner.responders.includes(responder)) runner.responders.push(responder)
			return true
		}
		runner = runner.inner as typeof runner
	}
	return false
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim()

/** The index of a rejected claim in `claims`: same text (ignoring case and spaces), else same text prefix and sources. */
export function findClaim(claims: Claim[], rejected: Claim): number {
	const text = norm(rejected.text)
	const exact = claims.findIndex((claim) => norm(claim.text) === text)
	if (exact >= 0) return exact
	const ids = [...rejected.sourceIds].sort().join(",")
	return claims.findIndex(
		(claim) => [...claim.sourceIds].sort().join(",") === ids && (norm(claim.text).startsWith(text.slice(0, 40)) || text.startsWith(norm(claim.text).slice(0, 40))),
	)
}

/** The claims without repeats: same text (ignoring case and spaces), the first one kept. */
export function uniqueClaims(claims: Claim[]): Claim[] {
	const seen = new Set<string>()
	return claims.filter((claim) => {
		const key = norm(claim.text)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

/** One model fix for one rejected claim. */
export interface ClaimFix {
	/** Index into the rejected list. */
	index: number
	action: "rewrite" | "drop"
	text: string
	sourceIds: string[]
}

export const CLAIM_FIXES_SCHEMA = {
	type: "array",
	items: {
		type: "object",
		additionalProperties: false,
		required: ["index", "action", "text", "sourceIds"],
		properties: {
			index: { type: "integer", description: "The \"index\" of the rejected claim this fix is for, as the input gives it." },
			action: { type: "string", enum: ["rewrite", "drop"] },
			text: { type: "string", description: "The corrected claim. Empty when dropped." },
			sourceIds: { type: "array", items: { type: "string" }, description: "Ids that support the corrected claim. Empty when dropped." },
		},
	},
}

/**
 * Apply fixes to the claim lists of an artifact: each rejected claim is rewritten or dropped,
 * every other claim stays exactly as it was. Returns the indexes of rejected claims it could not find.
 */
export function applyClaimFixes(lists: Claim[][], rejected: RejectedClaim[], fixes: ClaimFix[]): number[] {
	const missing: number[] = []
	const drops: Array<[Claim[], Claim]> = []
	const assigned = assignFixes(rejected, fixes)
	rejected.forEach((r, index) => {
		const list = lists.find((claims) => findClaim(claims, r.claim) >= 0)
		if (!list) {
			missing.push(index)
			return
		}
		const at = findClaim(list, r.claim)
		const fix = assigned.get(index)
		if (!fix || fix.action === "drop" || !fix.text.trim() || fix.sourceIds.length === 0) drops.push([list, list[at]])
		else list[at] = { text: fix.text.trim(), sourceIds: fix.sourceIds }
	})
	for (const [list, claim] of drops) list.splice(list.indexOf(claim), 1)
	return missing
}

/**
 * Which rejected claim each fix is for, by index into `rejected`. Models often give the claim's place in the artifact
 * instead of its index in the rejected list (31% of fix answers in the 20-company run of 30 Oct), so a rewrite goes to
 * the rejected claim it reads like: its own index when the words fit, else the closest one not taken, else its index.
 */
export function assignFixes(rejected: RejectedClaim[], fixes: ClaimFix[]): Map<number, ClaimFix> {
	const assigned = new Map<number, ClaimFix>()
	const inRange = (fix: ClaimFix) => Number.isInteger(fix.index) && fix.index >= 0 && fix.index < rejected.length
	const isRewrite = (fix: ClaimFix) => fix.action === "rewrite" && fix.text.trim() !== ""
	const fits = (fix: ClaimFix, index: number) => !isRewrite(fix) || likeness(fix.text, rejected[index].claim.text) >= LIKE
	const left: ClaimFix[] = []
	for (const fix of fixes) {
		if (inRange(fix) && !assigned.has(fix.index) && fits(fix, fix.index)) assigned.set(fix.index, fix)
		else left.push(fix)
	}
	const unplaced: ClaimFix[] = []
	for (const fix of left) {
		let best = -1
		let score = LIKE
		if (isRewrite(fix)) {
			rejected.forEach((r, index) => {
				const s = assigned.has(index) ? 0 : likeness(fix.text, r.claim.text)
				if (s >= score) [best, score] = [index, s]
			})
		}
		if (best >= 0) assigned.set(best, fix)
		else unplaced.push(fix)
	}
	for (const fix of unplaced) if (inRange(fix) && !assigned.has(fix.index)) assigned.set(fix.index, fix)
	return assigned
}

/** Below this share of shared words, a rewrite is not about that claim. */
const LIKE = 0.25

/** Shared words of two texts (3+ letters), as a share of the shorter one's words. */
function likeness(a: string, b: string): number {
	const words = (text: string) => new Set(norm(text).match(/[\p{L}\p{N}]{3,}/gu) ?? [])
	const [x, y] = [words(a), words(b)]
	if (!x.size || !y.size) return 0
	let shared = 0
	for (const word of x) if (y.has(word)) shared++
	return shared / Math.min(x.size, y.size)
}

/** The rejected claims as a fix prompt shows them, each with the index its fix must give. */
export function numbered(rejected: RejectedClaim[]): Array<RejectedClaim & { index: number }> {
	return rejected.map((r, index) => ({ index, ...r }))
}
