import type { RunResults } from "@shared/server/api"
import type { TraceRecord } from "@shared/types"
import * as format from "@/lib/format"
import type { RunView } from "./fold"

/** Model calls in flight over time: the picture of agents working at the same time. */
export interface Concurrency {
	/** Average calls in flight in each time slice. */
	series: number[]
	/** Most calls in flight at one moment, and when. */
	peak: number
	peakMs: number
}

export function concurrency(records: TraceRecord[], duration: number, buckets = 120): Concurrency {
	const series = new Array<number>(buckets).fill(0)
	const size = Math.max(duration, 1) / buckets
	const open = new Map<string, number>()
	const edges: [number, number][] = []
	const add = (start: number, end: number) => {
		edges.push([start, 1], [end, -1])
		for (let i = Math.floor(start / size); i <= Math.min(buckets - 1, Math.floor(end / size)); i++) {
			const overlap = Math.min(end, (i + 1) * size) - Math.max(start, i * size)
			if (overlap > 0) series[i] += overlap / size
		}
	}
	for (const record of records) {
		if (!record.loopId) continue
		if (record.kind === "inference.started") open.set(record.loopId, record.ms)
		else if (record.kind === "inference.completed") {
			const start = open.get(record.loopId)
			if (start != null) add(start, record.ms)
			open.delete(record.loopId)
		}
	}
	for (const start of open.values()) add(start, duration)

	// Exact peak: sweep the start and end edges in time order (ends first at the same ms).
	edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
	let now = 0
	let peak = 0
	let peakMs = 0
	for (const [ms, delta] of edges) {
		now += delta
		if (now > peak) {
			peak = now
			peakMs = ms
		}
	}
	return { series, peak, peakMs }
}

export type StageKey = "need" | "profile" | "pair" | "proposal" | "review"
export type StageState = "done" | "working" | "waiting" | "skipped"

export interface Stage {
	key: StageKey
	label: string
	/** What the count counts, for one line under it. */
	unit: string
	count: number
	detail?: string
	state: StageState
}

const TASK_KIND: Record<StageKey, string> = { need: "analyze", profile: "profile", pair: "match", proposal: "write", review: "critique" }

/**
 * The run as five steps, from the trace (`artifact.posted`, `critic.*`) and, when present, the results files.
 * Works while a run is live: counts grow and the busy step shows as working.
 */
export function pipeline(records: TraceRecord[], view: RunView, results: RunResults | null, live: boolean): Stage[] {
	const posted: Record<string, Set<string>> = { need: new Set(), profile: new Set(), pair: new Set(), proposal: new Set() }
	let reviews = 0
	let sentBack = 0
	let rejectedClaims = 0
	for (const record of records) {
		const data = record.data as { kind?: string; id?: string; rejected?: unknown[] } | undefined
		if (record.kind === "artifact.posted" && data?.kind && data.id) posted[data.kind]?.add(data.id)
		else if (record.kind === "critic.verdict") {
			reviews++
			rejectedClaims += data?.rejected?.length ?? 0
		} else if (record.kind === "critic.sent_back") sentBack++
	}
	const running = new Set<string>()
	for (const task of view.tasks.values()) if (task.status === "running" && !task.stopped) running.add(String(task.kind))

	const stage = (key: StageKey, label: string, unit: string, count: number, detail?: string): Stage => ({
		key,
		label,
		unit,
		count,
		detail,
		state: running.has(TASK_KIND[key]) ? "working" : count > 0 ? "done" : live ? "waiting" : "skipped",
	})
	const noMatch = results?.noMatches.length ?? 0
	return [
		stage("need", "Read companies", "challenges", Math.max(posted.need.size, results?.needs.length ?? 0)),
		stage("profile", "Profile researchers", "profiles", Math.max(posted.profile.size, results?.profiles.length ?? 0)),
		stage("pair", "Find pairs", "pairs", Math.max(posted.pair.size, results?.pairs.length ?? 0), noMatch ? `${noMatch} with no good match` : undefined),
		stage("proposal", "Write proposals", "proposals", Math.max(posted.proposal.size, results?.proposals.length ?? 0)),
		stage("review", "Check claims", "reviews", reviews, reviews ? `${format.plural(rejectedClaims, "claim")} rejected, ${sentBack} sent back` : undefined),
	]
}
