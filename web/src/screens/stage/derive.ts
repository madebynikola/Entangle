import type { TraceRecord } from "@shared/types"
import { useRef } from "react"
import type { FaceId, FaceState } from "@/lib/faces"
import { ROLE_INFO, roleOf } from "@/lib/roles"
import type { AgentView, RunView } from "@/run/fold"

/**
 * What the Stage reads from the trace: the feed as lines the faces say to each other, and each face's state at the
 * playhead. Pure functions of the view and the clock, so the Stage follows seeking, pausing and speed like the Timeline.
 */

/** The seven faces round the bus, clockwise from the top (as in design/agents/simulation.html). */
export const ORDER: FaceId[] = ["deneb", "tycho", "fides", "you", "tinta", "amity", "spica"]

/** One published event, as a line one face says to the others. */
export interface Line {
	key: string
	ms: number
	from: FaceId
	/** The faces it is addressed to; the others still see it on the bus. */
	to: FaceId[] | "all"
	kind: string
	text: string
	/** The Critic's verdict lands on this face as a stamp. */
	stamp?: { on: FaceId; ok: boolean }
	/** Amity's match line between the company side (Spica) and the researcher side (Tycho). */
	link?: boolean
	/** A face that reacts for a moment: a sweat drop on reject, a cheer on done. */
	mood?: { face: FaceId; state: FaceState }
	/** The end of the run: everyone is done. */
	finale?: boolean
}

/** How long a reaction lasts on the run clock, in ms. */
export const SAY_MS = 2800
export const STAMP_MS = 2200
export const MOOD_MS = 2400
export const LINK_MS = 3200
export const PULSE_MS = 1300

/** Whose artifact each kind is. */
const AUTHOR: Record<string, FaceId> = { need: "spica", profile: "tycho", pair: "amity", proposal: "tinta" }

const VERB: Record<string, string> = { analyze: "read", profile: "profile", match: "match", write: "write", critique: "check" }

function faceOf(agent: string | undefined): FaceId {
	return ROLE_INFO[roleOf(agent)].face ?? "deneb"
}

function cut(text: string, max = 96): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

type Data = Record<string, unknown>
const str = (value: unknown) => (typeof value === "string" ? value : "")
const num = (value: unknown) => (typeof value === "number" ? value : 0)
const list = (value: unknown) => (Array.isArray(value) ? value : [])

/** One feed record as a line, or null for events the Stage does not voice. */
export function lineOf(record: TraceRecord, index: number): Line | null {
	const data = (record.data ?? {}) as Data
	const base = { key: `${index}`, ms: record.ms, kind: record.kind }
	switch (record.kind) {
		case "orchestrator.plan": {
			const companies = list(data.companies).length
			return { ...base, from: "deneb", to: "all", text: `${companies} companies, ${num(data.challenges)} challenges. Let's find pairs.` }
		}
		case "orchestrator.assigned": {
			const assignee = str(data.assignee)
			const verb = VERB[str(data.kind)] ?? "take"
			return { ...base, from: "deneb", to: [faceOf(assignee)], text: `${assignee}, ${verb} ${str(data.subjectId)}.` }
		}
		case "shortlist.ready":
			return {
				...base,
				from: "deneb",
				to: ["tycho"],
				text: `Search found ${list(data.researcherIds).length} researchers for ${str(data.challengeId)}. Tycho, profile them.`,
			}
		case "artifact.posted": {
			const kind = str(data.kind)
			const id = str(data.id)
			const from = AUTHOR[kind] ?? faceOf(record.agent)
			const text =
				kind === "need"
					? `Posted the need ${id}.`
					: kind === "profile"
						? `${id} is profiled.`
						: kind === "pair"
							? `Paired ${id.replace(":", " with ")}.`
							: kind === "proposal"
								? `Drafted the proposal ${id}.`
								: `Posted ${id}.`
			return { ...base, from, to: ["fides"], text, link: kind === "pair" }
		}
		case "critic.verdict": {
			const author = AUTHOR[str(data.kind)] ?? "deneb"
			const id = str(data.id)
			if (data.ok) return { ...base, from: "fides", to: [author], text: `${id} checks out.`, stamp: { on: author, ok: true }, mood: { face: author, state: "done" } }
			const first = list(data.rejected)[0] as { reason?: string } | undefined
			const action = str(data.action)
			const text =
				action === "human-review"
					? `${id} needs a person to decide.`
					: action === "drop"
						? `Dropped ${id}: it cannot be fixed.`
						: `Sent back ${id}. ${first?.reason ? cut(first.reason) : "A claim has no source."}`
			return {
				...base,
				from: "fides",
				to: action === "human-review" ? ["you", author] : [author],
				text,
				stamp: { on: author, ok: false },
				mood: action === "human-review" ? { face: "you", state: "working" } : { face: author, state: "reject" },
			}
		}
		case "match.none":
			return { ...base, from: "amity", to: "all", text: `No good match for ${str(data.challengeId)}. ${cut(str(data.reason), 72)}`, mood: { face: "amity", state: "reject" } }
		case "pair.dropped":
			return { ...base, from: "amity", to: "all", text: `Dropped ${str(data.pairId).replace(":", " with ")}.` }
		case "orchestrator.decided":
			return { ...base, from: "deneb", to: ["tinta"], text: `${str(data.companyId)}: write ${str(data.pairId).replace(":", " with ")}.` }
		case "orchestrator.done": {
			const proposals = list(data.proposals).length
			return { ...base, from: "deneb", to: "all", text: `Done. ${proposals} proposals from ${num(data.pairs)} pairs.`, finale: true }
		}
		case "task.failed":
			return { ...base, from: faceOf(record.agent), to: ["deneb"], text: `${record.taskId ?? "A task"} failed.`, mood: { face: faceOf(record.agent), state: "reject" } }
		default:
			return null
	}
}

/**
 * The feed as lines, kept in step with the playhead. The feed only grows while the playhead moves forward,
 * so only new records are read; a seek back starts over.
 */
export function useLines(feed: TraceRecord[]): Line[] {
	const cache = useRef<{ feed: TraceRecord[]; read: number; lines: Line[] }>({ feed: [], read: 0, lines: [] })
	const prev = cache.current
	if (prev.feed === feed) return prev.lines
	const grew = feed.length >= prev.read && (prev.read === 0 || feed[prev.read - 1] === prev.feed[prev.read - 1])
	const lines = grew ? prev.lines.slice() : []
	for (let i = grew ? prev.read : 0; i < feed.length; i++) {
		const line = lineOf(feed[i], i)
		if (line) lines.push(line)
	}
	cache.current = { feed, read: feed.length, lines }
	return lines
}

/** The lines whose effect is still on screen at `clock`, newest last. Lines are in ms order. */
export function recent(lines: Line[], clock: number, windowMs: number): Line[] {
	const out: Line[] = []
	for (let i = lines.length - 1; i >= 0 && clock - lines[i].ms <= windowMs; i--) if (lines[i].ms <= clock) out.unshift(lines[i])
	return out
}

export interface Cast {
	face: FaceId
	total: number
	working: number
	state: FaceState
}

/**
 * Each face's state at `clock`. A fresh mood (a send-back, a pass) wins for a moment; then working while any agent of
 * the role is in a model call; then done once the run has ended; else idle. Deneb conducts while anyone works.
 */
export function cast(view: RunView, lines: Line[], clock: number, ended: boolean, waitingOnYou: boolean): Map<FaceId, Cast> {
	const out = new Map<FaceId, Cast>(ORDER.map((face) => [face, { face, total: 0, working: 0, state: "idle" }]))
	for (const agent of view.agents.values() as Iterable<AgentView>) {
		const face = ROLE_INFO[agent.role].face
		const entry = face && out.get(face)
		if (!entry || agent.leftMs != null) continue
		entry.total++
		if (agent.activity !== "idle") entry.working++
	}
	const busy = [...out.values()].some((entry) => entry.working > 0)
	const moods = new Map<FaceId, FaceState>()
	let finale = false
	for (const line of recent(lines, clock, MOOD_MS)) {
		if (line.mood) moods.set(line.mood.face, line.mood.state)
		if (line.stamp && line.from === "fides") moods.set("fides", line.stamp.ok ? "done" : "reject")
	}
	for (const line of lines) if (line.finale && line.ms <= clock) finale = true
	for (const entry of out.values()) {
		const mood = moods.get(entry.face)
		if (mood) entry.state = mood
		else if (entry.working > 0 || (entry.face === "deneb" && busy && !finale)) entry.state = "working"
		else if (entry.face === "you") entry.state = waitingOnYou ? "working" : finale || ended ? "done" : "idle"
		else if (finale || ended) entry.state = "done"
	}
	return out
}
