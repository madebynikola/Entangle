import type { RunInfo } from "@shared/server/api"
import { useEffect, useMemo, useState } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { getBackend, type Backend } from "./backend"
import { endRun, foldTrace, type RunView } from "./fold"
import { runClock, useRunStore, type RunStore } from "./store"

export { useRunStore, runClock, MIN_ZOOM_MS } from "./store"
export type { Speed, Mode, TimeRange } from "./store"

/** Pick from the open run's store. Use a narrow selector, or useShallow for objects. */
export function useRun<T>(selector: (state: RunStore) => T): T {
	return useRunStore(selector)
}

/** The fold of the trace up to the playhead: agents, loops, tasks, totals, feed. */
export function useRunView(): RunView {
	return useRunStore((state) => state.view)
}

/**
 * The whole run as far as it is known, whatever the playhead shows: for summaries (Overview, header numbers).
 * The same object as useRunView() unless a replay is part-way through.
 */
export function useFullView(): RunView {
	const view = useRunStore((state) => state.view)
	const records = useRunStore((state) => state.records)
	const partial = useRunStore((state) => state.applied < state.records.length && state.mode !== "live")
	const ended = useRunStore((state) => state.runStatus === "ended")
	// Fold once per record list, not once per replay frame.
	const full = useMemo(() => (partial ? (ended ? endRun(foldTrace(records)) : foldTrace(records)) : null), [partial, ended, records])
	return full ?? view
}

/** The open run's results (needs, profiles, pairs, proposals, verdicts, approvals), or null while loading. */
export function useResults() {
	return useRunStore(useShallow((state) => ({ results: state.results, error: state.resultsError, runId: state.runId })))
}

/**
 * Run ms now, re-rendering every animation frame while the run is live or playing.
 * Call it once near the top of an animated view (the swimlanes) and pass the value down,
 * or read `runClock()` inside your own requestAnimationFrame loop.
 */
export function useRunClock(): number {
	const active = useRunStore((state) => state.mode === "live" || state.playing)
	const position = useRunStore((state) => state.position)
	const [now, setNow] = useState(() => runClock())
	useEffect(() => {
		if (!active) return
		let frame = requestAnimationFrame(function loop() {
			setNow(runClock())
			frame = requestAnimationFrame(loop)
		})
		return () => cancelAnimationFrame(frame)
	}, [active])
	return active ? now : position
}

// ---------------------------------------------------------------------------
// The backend and the list of runs
// ---------------------------------------------------------------------------

interface RunsStore {
	backend: Backend | null
	runs: RunInfo[] | null
	error: string | null
	refresh(): Promise<void>
}

export const useRunsStore = create<RunsStore>()((set) => ({
	backend: null,
	runs: null,
	error: null,
	async refresh() {
		try {
			const backend = await getBackend()
			set({ backend, runs: await backend.listRuns(), error: null })
		} catch (error) {
			set({ error: error instanceof Error ? error.message : String(error) })
		}
	},
}))

/** All runs, newest first, with the sample run last. Polls the server every 3 s while the page is visible. */
export function useRuns(): RunInfo[] | null {
	const runs = useRunsStore((state) => state.runs)
	const kind = useRunsStore((state) => state.backend?.kind)
	useEffect(() => {
		void useRunsStore.getState().refresh()
		if (kind !== "server") return
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") void useRunsStore.getState().refresh()
		}, 3000)
		return () => clearInterval(timer)
	}, [kind])
	return runs
}

/** The backend once it is known: "server" (local, live) or "static" (hosted build). */
export function useBackend(): Backend | null {
	return useRunsStore((state) => state.backend)
}
