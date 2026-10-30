import { AlertTriangle, Play } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect } from "react"
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusLabel } from "@/components/ui/status"
import { RouteTabs } from "@/components/ui/tabs"
import * as format from "@/lib/format"
import { runClock, useFullView, useRunStore, type Speed } from "@/run/hooks"
import { ReplayBar } from "./replay-bar"
import { runLabel, runState } from "./run-label"
import { TopBar } from "./top-bar"

/**
 * /runs/:runId: opens the run in the store, then shows the top bar with its tabs, the run's title and the screen.
 * Tabs: Overview (what happened), Timeline (agents at work, with the replay bar) and Results (pairs and proposals).
 * Query: `?replay` plays a finished run from the start; `?speed=1|4|instant`.
 */
export function RunLayout() {
	const { runId = "" } = useParams()
	const [params] = useSearchParams()
	const { pathname } = useLocation()
	const open = useRunStore((state) => state.open)
	const { info, loading, error, proposals, live } = useRunStore(
		useShallow((state) => ({
			info: state.info,
			loading: state.loading,
			error: state.error,
			proposals: state.results?.proposals.length,
			live: state.runStatus === "live",
		})),
	)
	const onTimeline = pathname.includes("/live")

	useEffect(() => {
		const speed = params.get("speed")
		void open(runId, {
			replay: params.has("replay"),
			speed: speed === "instant" ? "instant" : speed === "1" || speed === "4" ? (Number(speed) as Speed) : undefined,
		})
		// Open once per run id; the query only sets how it starts.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runId, open])
	useEffect(() => () => useRunStore.getState().close(), [])

	// A replay belongs to the Timeline: leaving it pauses, so the other tabs stay still.
	useEffect(() => {
		const store = useRunStore.getState()
		if (!onTimeline && store.mode === "replay" && store.playing) store.pause()
	}, [onTimeline])
	usePlayerKeys(onTimeline)

	return (
		<>
			<TopBar run={info}>
				<RouteTabs
					items={[
						{ value: "overview", label: "Overview", to: "overview" },
						{ value: "live", label: live ? <LiveLabel /> : "Timeline", to: "live" },
						{ value: "results", label: "Results", count: proposals || undefined, to: "results" },
					]}
				/>
			</TopBar>
			<main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-8 sm:px-6">
				{error ? (
					<EmptyState
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
				) : (
					<>
						<RunTitle />
						{loading ? <LoadingBody /> : <Outlet />}
					</>
				)}
			</main>
			<AnimatePresence>
				{onTimeline && !loading && !error && (
					<motion.div
						initial={{ opacity: 0, y: 16 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 16 }}
						transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
						className="pointer-events-none fixed inset-x-4 bottom-5 z-20 flex justify-center"
					>
						<ReplayBar />
					</motion.div>
				)}
			</AnimatePresence>
		</>
	)
}

function LiveLabel() {
	return (
		<span className="inline-flex items-center gap-1.5">
			Live
			<span className="size-1.5 animate-pulse-dot rounded-full bg-working text-working" />
		</span>
	)
}

/** The run's name, its state in words, and one primary action. The same on every tab. */
function RunTitle() {
	const info = useRunStore((state) => state.info)
	const view = useFullView()
	const navigate = useNavigate()
	const { pathname } = useLocation()
	if (!info) {
		return (
			<div className="mb-8">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="mt-3 h-4 w-80" />
			</div>
		)
	}
	const state = runState(info)
	const ran = info.status === "live" ? `running for ${format.duration(view.lastMs)}` : `ran for ${format.duration(info.durationMs ?? view.lastMs)}`
	const watch = () => {
		navigate("live")
		useRunStore.getState().restart()
	}

	return (
		<div className="mb-8 flex flex-wrap items-end justify-between gap-4">
			<div className="min-w-0">
				<h1 className="truncate text-2xl font-semibold text-ink">{runLabel(info)}</h1>
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
					<StatusLabel tone={state.tone} pulse={state.pulse}>
						{state.label}
					</StatusLabel>
					<span>{ran}</span>
					{!info.sample && info.startedAt && <span>started {format.ago(info.startedAt)}</span>}
					{info.sample && <Chip>Invented data</Chip>}
					{info.mock && !info.sample && <Chip>Mock model</Chip>}
				</div>
			</div>
			{info.status !== "live" && !pathname.includes("/live") && view.loops.size > 0 && (
				<Button variant="primary" onClick={watch}>
					<Play className="fill-current" />
					Watch the replay
				</Button>
			)}
		</div>
	)
}

function LoadingBody() {
	return (
		<div className="grid gap-4">
			<Skeleton className="h-24 rounded-lg" />
			<Skeleton className="h-64 rounded-lg" />
		</div>
	)
}

/** On the Timeline: Space plays or pauses, ← → step 5 s, L follows live. Not while typing or in a dialog. */
function usePlayerKeys(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null
			if (event.metaKey || event.ctrlKey || event.altKey) return
			if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog], button, a")) return
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
	}, [enabled])
}
