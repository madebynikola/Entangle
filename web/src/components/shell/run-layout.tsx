import { AlertTriangle, ChevronRight, FlaskConical } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect } from "react"
import { Link, Outlet, useParams, useSearchParams } from "react-router"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Meta } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { LoadingState } from "@/components/ui/skeleton"
import { Status, type StatusTone } from "@/components/ui/status"
import { RouteTabs } from "@/components/ui/tabs"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { runClock, useRunClock, useRunStore, type Speed } from "@/run/hooks"
import { usePalette } from "./command-palette"
import { ReplayBar } from "./replay-bar"
import { runLabel } from "./run-label"

/**
 * /runs/:runId — opens the run in the store, then shows its header, the screen (live or results) and the replay bar.
 * Query: `?replay` replays a live run from the start; `?speed=1|4|instant`.
 */
export function RunLayout() {
	const { runId = "" } = useParams()
	const [params] = useSearchParams()
	const open = useRunStore((state) => state.open)
	const { loading, error, hasRecords } = useRunStore(
		useShallow((state) => ({ loading: state.loading, error: state.error, hasRecords: state.records.length > 0 || state.mode === "live" })),
	)

	useEffect(() => {
		const speed = params.get("speed")
		void open(runId, {
			replay: params.has("replay"),
			speed: speed === "instant" ? "instant" : speed === "1" || speed === "4" ? (Number(speed) as Speed) : undefined,
		})
		// Open once per run id; the speed param only sets the start speed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runId, open])

	useEffect(() => () => useRunStore.getState().close(), [])
	usePlayerKeys()

	if (error) {
		return (
			<EmptyState
				className="flex-1"
				icon={<AlertTriangle />}
				title="This run could not be loaded"
				action={
					<Button asChild>
						<Link to="/">See all runs</Link>
					</Button>
				}
			>
				{error}
			</EmptyState>
		)
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<RunHeader />
			<div className="relative min-h-0 flex-1 overflow-y-auto scrollbar-thin">
				{loading ? <LoadingState label="Loading the trace" className="px-6 py-5" /> : <Outlet />}
			</div>
			<AnimatePresence>
				{!loading && hasRecords && (
					<motion.div
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 12 }}
						transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
						className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center"
					>
						<ReplayBar />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	)
}

function RunHeader() {
	const { runId, info, results, view, mode, playing, speed, duration, runStatus, loading } = useRunStore(
		useShallow((state) => ({
			runId: state.runId,
			info: state.info,
			results: state.results,
			view: state.view,
			mode: state.mode,
			playing: state.playing,
			speed: state.speed,
			duration: state.duration,
			runStatus: state.runStatus,
			loading: state.loading,
		})),
	)
	const clock = useRunClock()
	const working = [...view.agents.values()].filter((agent) => agent.activity !== "idle").length
	const { totals } = view

	let tone: StatusTone = "idle"
	let pulse = false
	let text: string
	if (loading) text = "Loading the trace…"
	else if (mode === "live") {
		tone = "working"
		pulse = true
		text = `live · ${format.plural(working, "agent")} working · ${format.plural(totals.inFlight, "model call")} in flight`
	} else if (runStatus === "stalled" && clock >= duration) {
		tone = "needs"
		text = "no new events for a while · the run may have stopped"
	} else if (playing) {
		tone = "info"
		text = `replaying at ${speed === "instant" ? "full speed" : `${speed}×`} · ${format.clock(clock)} of ${format.clock(duration)}`
	} else if (clock < duration) text = `paused at ${format.clock(clock)} of ${format.clock(duration)}`
	else text = `finished · ran for ${format.duration(duration)}`

	const cost = totals.costUsd > 0 ? `${format.usd(totals.costUsd)}${totals.costKnown ? "" : "+"}${info?.mock ? " simulated" : ""}` : null

	return (
		<header className="shrink-0 px-6 pt-5">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5 text-xl">
						<Link to="/" className="text-ink-muted transition-colors hover:text-ink">
							Runs
						</Link>
						<ChevronRight className="size-4 text-ink-subtle" />
						<h1 className="truncate text-ink">{info ? runLabel(info) : runId}</h1>
					</div>
					<Status tone={tone} pulse={pulse} className="mt-1 text-sm">
						{text}
					</Status>
				</div>
				<div className="flex shrink-0 items-center gap-2 pt-1">
					{info?.sample && (
						<Tooltip content="Invented data that shows what a run looks like">
							<Chip icon={<FlaskConical />}>Sample data</Chip>
						</Tooltip>
					)}
					{info?.mock && !info.sample && (
						<Tooltip content="Ran on the mock model: fake latency, no API calls">
							<Chip>Mock model</Chip>
						</Tooltip>
					)}
					<Button variant="quiet" size="sm" className="hidden sm:inline-flex" onClick={() => usePalette.getState().setOpen(true)}>
						⌘K
					</Button>
				</div>
			</div>

			<div className="mt-3 flex items-end justify-between gap-6 border-b border-hairline">
				<RouteTabs
					className="border-b-0"
					items={[
						{ value: "live", label: "Live", count: working || undefined, to: "live" },
						{ value: "results", label: "Results", count: results?.proposals.length || undefined, to: "results" },
					]}
				/>
				<Meta
					className="hidden pb-2.5 lg:flex"
					items={[
						format.plural(view.agents.size, "agent"),
						`${totals.done}/${format.plural(totals.tasks, "task")}`,
						totals.failed > 0 && <span className="text-failed">{totals.failed} failed</span>,
						`${format.tokens(totals.tokens)} tokens`,
						cost,
						totals.maxInFlight > 1 && `up to ${totals.maxInFlight} at once`,
						totals.sentBack > 0 && <span className="text-needs">{totals.sentBack} sent back</span>,
						totals.retries > 0 && `${format.plural(totals.retries, "retry", "retries")}`,
					]}
				/>
			</div>
		</header>
	)
}

/** Space plays or pauses, ← → step 5 s, L follows live. Not while typing or with a dialog open. */
function usePlayerKeys() {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null
			if (event.metaKey || event.ctrlKey || event.altKey) return
			if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=slider], button")) {
				if (!(event.key === " " && target?.closest("[role=slider]"))) return
			}
			const store = useRunStore.getState()
			if (!store.runId || store.loading) return
			if (event.key === " ") store.toggle()
			else if (event.key === "ArrowLeft") store.seek(runClock() - 5000)
			else if (event.key === "ArrowRight") store.seek(runClock() + 5000)
			else if (event.key.toLowerCase() === "l") store.goLive()
			else return
			event.preventDefault()
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])
}
