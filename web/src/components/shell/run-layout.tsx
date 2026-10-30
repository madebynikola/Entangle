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
import { Meta } from "@/components/ui/card"
import { RouteTabs } from "@/components/ui/tabs"
import * as format from "@/lib/format"
import { runClock, useFullView, useRunStore, type Speed } from "@/run/hooks"
import { PageHeader } from "./page-header"
import { ReplayBar } from "./replay-bar"
import { runLabel, runState } from "./run-label"

/**
 * /runs/:runId: opens the run in the store, then fills the panel: the header (title, facts, tabs), the screen, and on the Timeline the replay bar.
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
			<PageHeader
				title={info ? runLabel(info) : <Skeleton className="h-6 w-40" />}
				meta={<RunMeta />}
				actions={<WatchButton />}
				tabs={
					<RouteTabs
						items={[
							{ value: "overview", label: "Overview", to: "overview" },
							{ value: "live", label: live ? <LiveLabel /> : "Timeline", to: "live" },
							{ value: "results", label: "Results", count: proposals || undefined, to: "results" },
						]}
					/>
				}
			/>
			{/* The screen's area: a fixed height. Screens fit it and scroll inside their own lists; this scrolls only as a fallback. */}
			<div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">
				{error ? (
					<EmptyState
						className="h-full"
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
				) : loading ? (
					<LoadingBody />
				) : (
					<Outlet />
				)}
			</div>
			<AnimatePresence initial={false}>
				{onTimeline && !loading && !error && (
					<motion.div
						key="replay"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
						className="shrink-0 overflow-hidden"
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

/** One quiet line of facts next to the title: state, time, team, tokens, cost. The same on every tab. */
function RunMeta() {
	const info = useRunStore((state) => state.info)
	const view = useFullView()
	if (!info) return <Skeleton className="h-4 w-64" />
	const state = runState(info)
	const { totals } = view
	return (
		<Meta
			items={[
				<StatusLabel key="state" tone={state.tone} pulse={state.pulse}>
					{state.label}
				</StatusLabel>,
				format.duration(info.status === "live" ? view.lastMs : (info.durationMs ?? view.lastMs)),
				view.agents.size > 0 && format.plural(view.agents.size, "agent"),
				totals.tokens > 0 && `${format.tokens(totals.tokens)} tokens`,
				totals.costUsd > 0 && `${format.usd(totals.costUsd)}${totals.costKnown ? "" : "+"}`,
				!info.sample && info.startedAt && format.ago(info.startedAt),
				info.sample ? <Chip key="kind">Invented data</Chip> : info.mock ? <Chip key="kind">Mock model</Chip> : null,
			]}
		/>
	)
}

/** A finished run opens still. This plays it on the Timeline from the start. */
function WatchButton() {
	const info = useRunStore((state) => state.info)
	const view = useFullView()
	const navigate = useNavigate()
	const { pathname } = useLocation()
	if (!info || info.status === "live" || pathname.includes("/live") || view.loops.size === 0) return null
	return (
		<Button
			variant="primary"
			onClick={() => {
				navigate("live")
				useRunStore.getState().restart()
			}}
		>
			<Play className="fill-current" />
			<span className="max-sm:sr-only">Watch the replay</span>
		</Button>
	)
}

function LoadingBody() {
	return (
		<div className="grid gap-4 p-5">
			<Skeleton className="h-28 rounded-lg" />
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
