import type { RunResults } from "@shared/server/api"
import type { Claim, TraceRecord } from "@shared/types"
import type { LoopView } from "@/run/fold"

/**
 * What the Timeline reads from the feed: the blackboard (every artifact.posted, with its review state) and the
 * Critic moments (every verdict that rejected claims). Pure functions of `view.feed`, so they follow the playhead.
 */

export interface Rejection {
	claim: Claim
	reason: string
	check?: string
	/** With two reviewers: the ones that rejected this claim. One name means they disagreed. */
	reviewers?: string[]
}

export type MomentAction = "send-back" | "drop" | "human-review"

/** The Critic rejected claims of an artifact: one `critic.verdict` with `ok: false`. */
export interface Moment {
	/** The verdict's index in the feed. The feed only grows, so this is stable. */
	key: number
	ms: number
	kind: string
	id: string
	revision?: number
	action: MomentAction
	/** The Critic participant that sent the verdict: the lane the claim flies from. */
	criticId: string
	critic: string
	/** The producer: the lane the claim flies to. */
	producerId?: string
	producerTaskId?: string
	/** The producer's new task that fixes the claims (`critic.sent_back`). */
	fixTaskId?: string
	attempt?: number
	maxAttempts?: number
	rejected: Rejection[]
	/** The two Critics disagreed (`critic.split`): both must pass, so the claim was rejected. */
	split?: string[]
}

export type ReviewState = "posted" | "reviewing" | "passed" | "sent-back" | "dropped" | "human-review"

/** One `artifact.posted`: an artifact landed on the blackboard. A fix posts it again as a new row. */
export interface Posting {
	/** Index in the feed. */
	key: number
	ms: number
	kind: string
	id: string
	/** 0 for the first post, +1 for each post after a send-back. */
	revision: number
	agentId: string
	agent: string
	state: ReviewState
	moment?: Moment
}

export interface Derived {
	postings: Posting[]
	moments: Moment[]
	/** Tasks that fix sent-back claims: their agents show "Fixing". */
	fixTasks: Set<string>
}

interface VerdictData {
	kind?: string
	id?: string
	ok?: boolean
	action?: string
	revision?: number
	producerId?: string
	producerTaskId?: string
	rejected?: Rejection[]
}

export function derive(feed: TraceRecord[]): Derived {
	const postings: Posting[] = []
	const moments: Moment[] = []
	const fixTasks = new Set<string>()
	const latestPost = new Map<string, Posting>()
	const latestMoment = new Map<string, Moment>()
	const splits = new Map<string, string[]>()

	feed.forEach((record, index) => {
		const data = (record.data ?? {}) as Record<string, unknown>
		const kind = String(data.kind ?? "")
		const id = String(data.id ?? "")
		const key = `${kind}:${id}`
		switch (record.kind) {
			case "artifact.posted": {
				const previous = latestPost.get(key)
				const posting: Posting = {
					key: index,
					ms: record.ms,
					kind,
					id,
					revision: previous ? previous.revision + 1 : 0,
					agentId: record.agentId,
					agent: record.agent ?? "",
					state: "posted",
				}
				postings.push(posting)
				latestPost.set(key, posting)
				break
			}
			case "critic.reviewing": {
				const posting = latestPost.get(key)
				if (posting?.state === "posted") posting.state = "reviewing"
				break
			}
			case "critic.split": {
				const reviewers = (data.reviewers as { reviewer: string }[] | undefined)?.map((r) => r.reviewer) ?? []
				splits.set(key, reviewers)
				break
			}
			case "critic.verdict": {
				const verdict = data as VerdictData
				const posting = latestPost.get(key)
				if (verdict.ok) {
					if (posting) posting.state = "passed"
					break
				}
				const action = actionOf(verdict.action)
				const moment: Moment = {
					key: index,
					ms: record.ms,
					kind,
					id,
					revision: verdict.revision,
					action,
					criticId: record.agentId,
					critic: record.agent ?? "critic",
					producerId: verdict.producerId ?? posting?.agentId,
					producerTaskId: verdict.producerTaskId,
					rejected: verdict.rejected ?? [],
					split: splits.get(key),
				}
				splits.delete(key)
				moments.push(moment)
				latestMoment.set(key, moment)
				if (posting) {
					posting.state = STATE[action]
					posting.moment = moment
				}
				break
			}
			case "critic.sent_back": {
				const moment = latestMoment.get(key)
				const taskId = data.taskId as string | undefined
				if (taskId) fixTasks.add(taskId)
				if (moment && !moment.fixTaskId) {
					moment.fixTaskId = taskId
					moment.attempt = data.attempt as number | undefined
					moment.maxAttempts = data.maxAttempts as number | undefined
				}
				break
			}
			case "critic.dropped":
			case "critic.escalated": {
				const action: MomentAction = record.kind === "critic.dropped" ? "drop" : "human-review"
				const moment = latestMoment.get(key)
				if (moment) moment.action = action
				const posting = latestPost.get(key)
				if (posting) posting.state = STATE[action]
				break
			}
		}
	})
	return { postings, moments, fixTasks }
}

const STATE: Record<MomentAction, ReviewState> = { "send-back": "sent-back", drop: "dropped", "human-review": "human-review" }

function actionOf(action: string | undefined): MomentAction {
	if (action === "drop") return "drop"
	if (action === "human-review") return "human-review"
	return "send-back"
}

export const KIND_LABEL: Record<string, string> = { need: "Need", profile: "Profile", pair: "Pair", proposal: "Proposal" }

export function kindLabel(kind: string): string {
	return KIND_LABEL[kind] ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : "Item")
}

/** Plain names for blackboard ids, from the run's results when they are loaded. */
export function nameLookup(results: RunResults | null): (kind: string, id: string) => string | undefined {
	if (!results) return () => undefined
	const companies = new Map(results.needs.map((need) => [need.challengeId, need.companyName]))
	const people = new Map(results.profiles.map((profile) => [profile.researcherId, profile.name]))
	const proposals = new Map(results.proposals.map((proposal) => [proposal.id, proposal.title]))
	return (kind, id) => {
		if (kind === "need") return companies.get(id)
		if (kind === "profile") return people.get(id)
		if (kind === "proposal") return proposals.get(id)
		if (kind === "pair") {
			const [challengeId, researcherId] = id.split(":")
			const person = people.get(researcherId)
			const company = companies.get(challengeId)
			return person && company ? `${person} and ${company}` : undefined
		}
		return undefined
	}
}

// ---------------------------------------------------------------------------
// Lane geometry
// ---------------------------------------------------------------------------

/**
 * Put each loop of one agent on a track, so loops that overlap sit on separate rows of its lane.
 * Greedy by start time; an open loop holds its track until it ends. `startOf` says where a loop's bar starts
 * (when its first call went out); a loop without one has no bar yet and waits for a track.
 */
export function pack(loops: Iterable<LoopView>, startOf: (loop: LoopView) => number | undefined): { track: Map<string, number>; tracks: number } {
	const sorted = [...loops]
		.map((loop) => ({ loop, start: startOf(loop) }))
		.filter((item): item is { loop: LoopView; start: number } => item.start != null)
		.sort((a, b) => a.start - b.start)
	const ends: number[] = []
	const track = new Map<string, number>()
	for (const { loop, start } of sorted) {
		let i = ends.findIndex((end) => end <= start)
		if (i < 0) i = ends.push(0) - 1
		ends[i] = loop.endMs ?? Infinity
		track.set(loop.id, i)
	}
	return { track, tracks: Math.max(1, ends.length) }
}

export interface LaneGeometry {
	height: number
	/** Top of the first track. */
	top: number
	bar: number
	pitch: number
}

/**
 * A lane fits its label at least; more tracks make it taller, with thinner bars.
 * Dense lanes (one-line labels) are for runs whose lanes would not fit the pane.
 */
export function laneGeometry(tracks: number, dense = false): LaneGeometry {
	const n = Math.max(1, tracks)
	const gap = n > 4 ? 1 : 2
	const room = dense ? 16 : 26
	const bar = Math.max(dense ? 2 : 3, Math.min(dense ? 8 : 12, Math.floor((room - (n - 1) * gap) / n)))
	const body = n * bar + (n - 1) * gap
	const height = Math.max(dense ? 24 : 44, body + (dense ? 8 : 18))
	return { height, top: Math.round((height - body) / 2), bar, pitch: bar + gap }
}

// ---------------------------------------------------------------------------
// Time scale
// ---------------------------------------------------------------------------

const STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((s) => s * 1000)

/** Ticks for an axis that shows `visible` ms at once: about six labels across. */
export function tickStep(visible: number): number {
	return STEPS.find((step) => visible / step <= 6) ?? STEPS.at(-1)!
}

/**
 * The axis length. A finished run uses its duration. A live run rounds up with room ahead,
 * so the scale changes now and then, not every frame.
 */
export function axisSpan(clock: number, duration: number, live: boolean): number {
	const end = Math.max(clock, duration, 1)
	if (!live) return end
	const step = tickStep(end * 1.1)
	return Math.ceil((end * 1.1) / step) * step
}

/** The playhead window in "follow" mode. */
export const FOLLOW_MS = 120_000

/** Which part of the axis is in view: all of it, or a window that keeps the playhead at 80%. */
export function viewWindow(now: number, span: number, follow: boolean): { start: number; visible: number } {
	if (!follow || span <= FOLLOW_MS) return { start: 0, visible: span }
	const start = Math.min(Math.max(0, now - FOLLOW_MS * 0.8), span - FOLLOW_MS)
	return { start, visible: FOLLOW_MS }
}
