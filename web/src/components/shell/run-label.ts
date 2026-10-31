import type { RunInfo } from "@shared/server/api"
import type { StatusTone } from "@/components/ui/status"
import { duration } from "@/lib/format"

const TIMESTAMP_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/

/** How a run is named: "Sample run", a named folder ("golden"), or when it started ("Today, 12:23"). */
export function runLabel(info: Pick<RunInfo, "id" | "startedAt" | "sample">): string {
	if (info.sample) return "Sample run"
	if (!TIMESTAMP_ID.test(info.id) || !info.startedAt) return info.id
	return friendlyTime(info.startedAt)
}

/** "Today, 12:23", "Yesterday, 18:02", "28 Oct, 09:15". */
export function friendlyTime(iso: string): string {
	const date = new Date(iso)
	const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
	const day = new Date(date).setHours(0, 0, 0, 0)
	const today = new Date().setHours(0, 0, 0, 0)
	if (day === today) return `Today, ${time}`
	if (day === today - 86_400_000) return `Yesterday, ${time}`
	return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`
}

/**
 * Which list a run belongs in. "run": a finished run on real models. "mock": a finished run on the mock model.
 * "incomplete": no summary (a dev script, or a run that stopped). Live runs always show.
 */
export type RunGroup = "sample" | "run" | "mock" | "incomplete"

export function runGroup(run: RunInfo): RunGroup {
	if (run.sample) return "sample"
	if (!run.has.summary && run.status !== "live") return "incomplete"
	return run.mock ? "mock" : "run"
}

/** The run's state in words, with its dot colour. */
export function runState(run: Pick<RunInfo, "status" | "sample" | "stopped">): { label: string; tone: StatusTone; pulse?: boolean } {
	if (run.sample) return { label: "Sample", tone: "info" }
	if (run.status === "live") return { label: "Running", tone: "working", pulse: true }
	if (run.status === "stalled" || run.stopped) return { label: "Stopped", tone: "needs" }
	return { label: "Finished", tone: "idle" }
}

/** "Stopped after 3m 05s: uncaught error … · partial results" for a run that crashed or got a signal; null for any other run. */
export function stoppedLine(run: Pick<RunInfo, "stopped" | "durationMs">): string | null {
	if (!run.stopped) return null
	const after = run.durationMs != null ? ` after ${duration(run.durationMs)}` : ""
	return `Stopped${after}: ${run.stopped} · partial results`
}
