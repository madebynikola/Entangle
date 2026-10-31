import type { ApprovalDecision, RunInfo, RunResults, RunStatus } from "@shared/server/api"
import type { TraceRecord } from "@shared/types"
import { create } from "zustand"
import { getBackend, type Backend } from "./backend"
import { applyRecords, emptyView, endRun, foldTrace, type RunView } from "./fold"

/**
 * The open run and its player. One run is open at a time (the route /runs/:runId opens it).
 *
 * live:   records apply as the server streams them; the clock is wall time since the run started.
 * replay: records apply as the playhead passes them, at 1×, 4× or instantly. Seeking switches a live run to replay;
 *         when the playhead catches up with a run that is still live, it follows live again.
 *
 * A finished run opens at its end, still: nothing moves until someone presses play (or opens it with `?replay`).
 * At the end of a finished run, calls that never completed show as stopped (see `endRun`), not as in flight.
 */

export type Speed = 1 | 4 | "instant"
export type Mode = "live" | "replay"

export interface RunStore {
	runId: string | null
	info: RunInfo | null
	loading: boolean
	error: string | null
	/** Every record loaded so far, in trace order. */
	records: TraceRecord[]
	/** The fold of records[0 .. applied). */
	view: RunView
	applied: number
	mode: Mode
	playing: boolean
	speed: Speed
	/** Replay playhead in run ms. In live mode it tracks the clock. */
	position: number
	/** `ms` of the last loaded record. */
	duration: number
	/** The server's view of the run. Null until known; "ended" for static builds and the sample. */
	runStatus: RunStatus | null
	results: RunResults | null
	resultsError: string | null

	open(runId: string, options?: { replay?: boolean; speed?: Speed }): Promise<void>
	close(): void
	play(): void
	pause(): void
	toggle(): void
	setSpeed(speed: Speed): void
	seek(ms: number): void
	restart(): void
	goLive(): void
	reloadResults(): Promise<void>
	approve(pairId: string, decision: ApprovalDecision | null, note?: string): Promise<void>
}

const initial = {
	runId: null,
	info: null,
	loading: false,
	error: null,
	records: [] as TraceRecord[],
	view: emptyView(),
	applied: 0,
	mode: "replay" as Mode,
	playing: false,
	speed: 4 as Speed,
	position: 0,
	duration: 0,
	runStatus: null,
	results: null,
	resultsError: null,
}

let stopStream: (() => void) | null = null
let frame = 0
let lastTick = 0
/** Bumped on every open(), so late answers for a previous run are dropped. */
let generation = 0

export const useRunStore = create<RunStore>()((set, get) => {
	/** Apply every loaded record with ms <= `position`. Rebuild from the start when the playhead moved back. */
	const applyUpTo = (position: number) => {
		const { records, applied, view } = get()
		if (applied > 0 && records[applied - 1].ms > position) {
			let end = 0
			while (end < records.length && records[end].ms <= position) end++
			set({ view: foldTrace(records.slice(0, end)), applied: end })
		} else {
			let end = applied
			while (end < records.length && records[end].ms <= position) end++
			if (end !== applied) set({ view: applyRecords(view, records.slice(applied, end)), applied: end })
		}
		settleEnd()
	}

	/** When the run has ended and every record is applied, close what is still open as stopped. */
	const settleEnd = () => {
		const { records, applied, view, runStatus } = get()
		if (runStatus === "ended" && records.length > 0 && applied === records.length && view.endedMs == null) set({ view: endRun(view) })
	}

	const tick = (now: number) => {
		frame = 0
		const state = get()
		if (state.mode === "replay" && state.playing) {
			const dt = lastTick ? now - lastTick : 0
			const position = Math.min(state.duration, state.position + dt * (state.speed === "instant" ? Infinity : state.speed))
			set({ position })
			applyUpTo(position)
			if (position >= state.duration) {
				if (state.runStatus === "live") set({ mode: "live", playing: true })
				else set({ playing: false })
			}
		} else if (state.mode === "live") {
			set({ position: liveClock(state) })
		}
		lastTick = now
		schedule()
	}

	const schedule = () => {
		const { mode, playing, runId } = get()
		const active = runId && (mode === "live" || playing)
		if (active && !frame) frame = requestAnimationFrame(tick)
		if (!active) lastTick = 0
	}

	const loadResults = async (backend: Backend, runId: string, gen: number) => {
		try {
			const results = await backend.getResults(runId)
			if (gen === generation) set({ results, resultsError: null })
		} catch (error) {
			if (gen === generation) set({ resultsError: message(error) })
		}
	}

	return {
		...initial,

		async open(runId, options = {}) {
			if (get().runId === runId && !get().error) {
				if (options.speed) get().setSpeed(options.speed)
				return
			}
			get().close()
			const gen = ++generation
			set({ ...initial, view: emptyView(), runId, loading: true, speed: options.speed ?? 4 })
			try {
				const backend = await getBackend()
				const info = await backend.getRun(runId)
				if (gen !== generation) return
				set({ info, runStatus: info.status })
				void loadResults(backend, runId, gen)

				if (info.status === "live" && backend.kind === "server" && !options.replay) {
					// Follow live: the stream sends the backlog first, then new lines.
					set({ mode: "live", playing: true, loading: false })
					stopStream = backend.streamTrace(runId, {
						onRecords(batch) {
							if (gen !== generation) return
							const records = [...get().records, ...batch]
							set({ records, duration: Math.max(get().duration, batch.at(-1)?.ms ?? 0) })
							if (get().mode === "live") applyUpTo(Infinity)
						},
						onStatus(runStatus) {
							if (gen !== generation) return
							set({ runStatus })
							settleEnd()
						},
						onEnd() {
							if (gen !== generation) return
							if (get().runStatus === "live") set({ runStatus: "ended" })
							if (get().mode === "live") set({ mode: "replay", playing: false, position: get().duration })
							settleEnd()
							void loadResults(backend, runId, gen)
						},
						onError(error) {
							if (gen === generation) set({ error })
						},
					})
				} else {
					const records = await backend.getTrace(runId)
					if (gen !== generation) return
					const duration = records.at(-1)?.ms ?? 0
					const replay = Boolean(options.replay) && get().speed !== "instant"
					set(
						replay
							? { records, duration, mode: "replay", loading: false, playing: true, position: 0 }
							: { records, duration, mode: "replay", loading: false, playing: false, position: duration, view: foldTrace(records), applied: records.length },
					)
					settleEnd()
				}
				schedule()
			} catch (error) {
				if (gen === generation) set({ loading: false, error: message(error) })
			}
		},

		close() {
			generation++
			stopStream?.()
			stopStream = null
			if (frame) cancelAnimationFrame(frame)
			frame = 0
			set({ ...initial, view: emptyView() })
		},

		play() {
			const { mode, position, duration } = get()
			if (mode === "live") return
			if (position >= duration) set({ position: 0, view: emptyView(), applied: 0 })
			set({ playing: true })
			if (get().speed === "instant") get().seek(get().duration)
			schedule()
		},
		pause() {
			if (get().mode === "live") set({ mode: "replay", position: get().view.lastMs })
			set({ playing: false })
		},
		toggle() {
			const { playing, mode } = get()
			if (playing || mode === "live") get().pause()
			else get().play()
		},
		setSpeed(speed) {
			set({ speed })
			if (speed === "instant" && get().mode === "replay") get().seek(get().duration)
		},
		seek(ms) {
			const position = Math.max(0, Math.min(get().duration, ms))
			set({ mode: "replay", position })
			applyUpTo(position)
			if (position >= get().duration && get().runStatus !== "live") set({ playing: false })
			schedule()
		},
		restart() {
			set({ mode: "replay", position: 0, view: emptyView(), applied: 0, playing: true })
			schedule()
		},
		goLive() {
			if (get().runStatus !== "live") return get().seek(get().duration)
			applyUpTo(Infinity)
			set({ mode: "live", playing: true })
			schedule()
		},

		async reloadResults() {
			const { runId } = get()
			if (runId) await loadResults(await getBackend(), runId, generation)
		},

		async approve(pairId, decision, note) {
			const { runId, results } = get()
			if (!runId || !results) return
			const backend = await getBackend()
			const approvals = await backend.setApproval(runId, { pairId, decision, note })
			if (get().runId === runId && get().results) set({ results: { ...get().results!, approvals } })
		},
	}
})

/** Run ms now: the playhead in replay, wall time since the run started when live. */
export function runClock(state: Pick<RunStore, "mode" | "position" | "view"> = useRunStore.getState()): number {
	return state.mode === "live" ? liveClock(state) : state.position
}

function liveClock(state: Pick<RunStore, "view">): number {
	const { startEpoch, lastMs } = state.view
	return startEpoch == null ? lastMs : Math.max(lastMs, Date.now() - startEpoch)
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
