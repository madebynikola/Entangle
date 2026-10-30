import type { TraceRecord } from "@shared/types"
import { useRef } from "react"
import type { FaceId, FaceState } from "@/lib/faces"
import { ROLE_INFO, roleOf } from "@/lib/roles"
import type { RunView } from "@/run/fold"

/**
 * What the Stage reads from the trace: each feed record as a Line (who did what to which item), and each face's
 * base state at the playhead. The director (director.ts) decides when and how the lines are shown; words.ts says them.
 */

/** The seven faces round the bus, clockwise from the top (as in design/agents/simulation.html). */
export const ORDER: FaceId[] = ["deneb", "tycho", "fides", "you", "tinta", "amity", "spica"]

/** What happened, in the Stage's own terms. */
export type Act =
	| "plan"
	| "assign"
	| "shortlist"
	| "post"
	| "pass"
	| "send-back"
	| "escalate"
	| "drop"
	| "no-match"
	| "pair-dropped"
	| "decide"
	| "done"
	| "fail"

export type Artifact = "need" | "profile" | "pair" | "proposal"

/** One feed record the Stage voices. */
export interface Line {
	key: string
	ms: number
	from: FaceId
	/** The faces it is addressed to; the others still see it on the bus. */
	to: FaceId[] | "all"
	act: Act
	kind: string
	artifact?: Artifact
	/** The item: a challenge, researcher, pair or proposal id. */
	id?: string
	/** Who gets an assignment (`analyst-2`), and what kind of task it is. */
	assignee?: string
	task?: string
	reason?: string
	count?: number
	/** Numbers for the plan and the end. */
	totals?: { companies?: number; challenges?: number; proposals?: number; pairs?: number }
}

/** Whose artifact each kind is. */
export const AUTHOR: Record<Artifact, FaceId> = { need: "spica", profile: "tycho", pair: "amity", proposal: "tinta" }

function faceOf(agent: string | undefined): FaceId {
	return ROLE_INFO[roleOf(agent)].face ?? "deneb"
}

type Data = Record<string, unknown>
const str = (value: unknown) => (typeof value === "string" ? value : "")
const num = (value: unknown) => (typeof value === "number" ? value : 0)
const list = (value: unknown) => (Array.isArray(value) ? value : [])
const artifactOf = (value: unknown): Artifact | undefined =>
	value === "need" || value === "profile" || value === "pair" || value === "proposal" ? value : undefined

/** One feed record as a line, or null for events the Stage does not voice. */
export function lineOf(record: TraceRecord, index: number): Line | null {
	const data = (record.data ?? {}) as Data
	const base = { key: `${index}`, ms: record.ms, kind: record.kind }
	switch (record.kind) {
		case "orchestrator.plan":
			return {
				...base,
				from: "deneb",
				to: "all",
				act: "plan",
				totals: { companies: list(data.companies).length, challenges: num(data.challenges) },
			}
		case "orchestrator.assigned": {
			const assignee = str(data.assignee)
			return { ...base, from: "deneb", to: [faceOf(assignee)], act: "assign", assignee, task: str(data.kind), id: str(data.subjectId) }
		}
		case "shortlist.ready":
			return { ...base, from: "deneb", to: ["tycho"], act: "shortlist", id: str(data.challengeId), count: list(data.researcherIds).length }
		case "artifact.posted": {
			const artifact = artifactOf(data.kind)
			return { ...base, from: artifact ? AUTHOR[artifact] : faceOf(record.agent), to: ["fides"], act: "post", artifact, id: str(data.id) }
		}
		case "critic.verdict": {
			const artifact = artifactOf(data.kind)
			const author = artifact ? AUTHOR[artifact] : "deneb"
			const id = str(data.id)
			if (data.ok) return { ...base, from: "fides", to: [author], act: "pass", artifact, id }
			const first = list(data.rejected)[0] as { reason?: string } | undefined
			const action = str(data.action)
			if (action === "human-review") return { ...base, from: "fides", to: ["you", author], act: "escalate", artifact, id }
			if (action === "drop") return { ...base, from: "fides", to: [author], act: "drop", artifact, id }
			return { ...base, from: "fides", to: [author], act: "send-back", artifact, id, reason: first?.reason, count: list(data.rejected).length }
		}
		case "match.none":
			return { ...base, from: "amity", to: "all", act: "no-match", id: str(data.challengeId), reason: str(data.reason) }
		case "pair.dropped":
			return { ...base, from: "amity", to: "all", act: "pair-dropped", artifact: "pair", id: str(data.pairId) }
		case "orchestrator.decided":
			return { ...base, from: "deneb", to: ["tinta"], act: "decide", artifact: "pair", id: str(data.pairId) }
		case "orchestrator.done":
			return { ...base, from: "deneb", to: "all", act: "done", totals: { proposals: list(data.proposals).length, pairs: num(data.pairs) } }
		case "task.failed":
			return { ...base, from: faceOf(record.agent), to: ["deneb"], act: "fail", id: record.taskId }
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

export interface Cast {
	face: FaceId
	total: number
	working: number
	/** From the run: working while any agent of the role is in a model call, done once the run has ended. */
	state: FaceState
}

/** Each face's base state at the playhead. Deneb conducts while anyone works. Reactions are the director's. */
export function cast(view: RunView, finished: boolean, waitingOnYou: boolean): Map<FaceId, Cast> {
	const out = new Map<FaceId, Cast>(ORDER.map((face) => [face, { face, total: 0, working: 0, state: "idle" }]))
	for (const agent of view.agents.values()) {
		const face = ROLE_INFO[agent.role].face
		const entry = face && out.get(face)
		if (!entry || agent.leftMs != null) continue
		entry.total++
		if (agent.activity !== "idle") entry.working++
	}
	const busy = [...out.values()].some((entry) => entry.working > 0)
	for (const entry of out.values()) {
		if (entry.working > 0 || (entry.face === "deneb" && busy && !finished)) entry.state = "working"
		else if (entry.face === "you") entry.state = waitingOnYou ? "working" : finished ? "done" : "idle"
		else if (finished) entry.state = "done"
	}
	return out
}
