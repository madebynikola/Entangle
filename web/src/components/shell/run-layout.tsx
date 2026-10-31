import { AlertTriangle, Play } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { useShallow } from "zustand/react/shallow"
import { BootMark } from "@/components/ui/boot"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusLabel } from "@/components/ui/status"
import { Meta } from "@/components/ui/card"
import { RouteTabs } from "@/components/ui/tabs"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { runClock, useFullView, useRunStore, type Speed } from "@/run/hooks"
import { FloatInsetsContext, useMeasureInsets } from "./float"
import { PageHeader } from "./page-header"
import { ReplayBar } from "./replay-bar"
import { runLabel, runState } from "./run-label"

/**
 * /runs/:runId: opens the run in the store, then fills the panel: the header (title, facts, tabs), the screen, and on the
 * Timeline and the Stage the replay bar.
 * Tabs: Stage (the agents' faces talking over the event bus; the main view, where a run opens), Timeline (agents at work;
 * both with the replay bar), Overview (what happened) and Results (pairs and proposals).
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
	/** The tabs that follow the playhead, and so get the replay bar. */
	const onTimeline = /\/(live|stage)(\/|$)/.test(pathname)
	const onStage = /\/stage(\/|$)/.test(pathname)
	const stageRef = useRef<HTMLDivElement>(null)
	const headRef = useRef<HTMLDivElement>(null)
	const footRef = useRef<HTMLDivElement>(null)
	const insets = useMeasureInsets(stageRef, headRef, footRef, onStage && !loading)

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

	// A replay belongs to the Timeline and the Stage: leaving them pauses, so the other tabs stay still.
	useEffect(() => {
		const store = useRunStore.getState()
		if (!onTimeline && store.mode === "replay" && store.playing) store.pause()
	}, [onTimeline])
	usePlayerKeys(onTimeline)

	const header = (
		<PageHeader
			title={info ? runLabel(info) : <Skeleton className="h-6 w-40" />}
			meta={<RunMeta />}
			actions={<WatchButton />}
			className={onStage ? FLOATING : undefined}
			tabs={
				<RouteTabs
					items={[
						{ value: "stage", label: "Stage", to: "stage" },
						{ value: "live", label: live ? <LiveLabel /> : "Timeline", to: "live" },
						{ value: "overview", label: "Overview", to: "overview" },
						{ value: "results", label: "Results", count: proposals || undefined, to: "results" },
					]}
				/>
			}
		/>
	)
	const body = error ? (
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
	)

	// The Stage fills the panel; the header and the replay bar float over it as cards.
	if (onStage) {
		return (
			<FloatInsetsContext.Provider value={insets}>
				<div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
					<div className="absolute inset-0">{body}</div>
					<div ref={headRef} className="absolute left-3 top-3 z-30 w-fit max-w-[calc(100%-24px)]">
						{header}
					</div>
					{!loading && !error && (
						<motion.div
							ref={footRef}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ duration: 0.25 }}
							className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-3xl"
						>
							<ReplayBar className={cn(FLOATING, "border-t")} />
						</motion.div>
					)}
				</div>
			</FloatInsetsContext.Provider>
		)
	}

	return (
		<>
			{header}
			{/* The screen's area: a fixed height. Screens fit it and scroll inside their own lists; this scrolls only as a fallback. */}
			<div className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">{body}</div>
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
						<ReplayBar ranged />
					</motion.div>
				)}
			</AnimatePresence>
		</>
	)
}

/** A card that floats over a full-bleed screen: frosted panel, hairline, a barely-there shadow. */
const FLOATING = "rounded-xl border border-hairline bg-panel/80 shadow-soft backdrop-blur-xl"

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

/** A finished run opens still. This plays it from the start, on the Stage. */
function WatchButton() {
	const info = useRunStore((state) => state.info)
	const view = useFullView()
	const navigate = useNavigate()
	const { pathname } = useLocation()
	const onStage = /\/stage(\/|$)/.test(pathname)
	if (!info || info.status === "live" || pathname.includes("/live") || view.loops.size === 0) return null
	return (
		<Button
			variant="primary"
			onClick={() => {
				if (!onStage) navigate("stage")
				useRunStore.getState().restart()
			}}
		>
			<Play className="fill-current" />
			<span className="max-sm:sr-only">Watch the replay</span>
		</Button>
	)
}

/** The boot animation, looping, while the run loads. It waits a moment first, so a quick load does not flash it. */
function LoadingBody() {
	const [shown, setShown] = useState(false)
	useEffect(() => {
		const timer = setTimeout(() => setShown(true), 300)
		return () => clearTimeout(timer)
	}, [])
	return (
		<div role="status" aria-label="Loading the run" className="grid h-full place-items-center p-5">
			{shown && <BootMark loop word={false} className="w-[min(160px,40vw)]" />}
		</div>
	)
}

/** On the Timeline and the Stage: Space plays or pauses, ← → step 5 s, L follows live. Not while typing or in a dialog. */
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
