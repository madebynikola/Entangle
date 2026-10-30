import type { RunInfo } from "@shared/server/api"
import { Play, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { runGroup, runLabel, runState, type RunGroup } from "@/components/shell/run-label"
import { TopBar } from "@/components/shell/top-bar"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusLabel } from "@/components/ui/status"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useBackend, useRuns } from "@/run/hooks"

type Filter = "runs" | "mock" | "all"

/** `/`: the runs, newest first. Real runs by default; mock and unfinished dev runs one click away. */
export function HomeScreen() {
	const runs = useRuns()
	const backend = useBackend()
	const navigate = useNavigate()
	const [starting, setStarting] = useState(false)
	const [query, setQuery] = useState("")

	const groups = useMemo(() => {
		const count: Record<RunGroup, number> = { sample: 0, run: 0, mock: 0, incomplete: 0 }
		for (const run of runs ?? []) count[runGroup(run)]++
		return count
	}, [runs])
	const [chosen, setFilter] = useState<Filter | null>(null)
	const filter: Filter = chosen ?? (groups.run > 0 ? "runs" : groups.mock > 0 ? "mock" : "all")

	const shown = (runs ?? []).filter((run) => {
		const group = runGroup(run)
		const inFilter =
			run.status === "live" || (filter === "all" ? true : filter === "runs" ? group === "run" || group === "sample" : group === "mock")
		const q = query.trim().toLowerCase()
		return inFilter && (!q || `${run.id} ${runLabel(run)}`.toLowerCase().includes(q))
	})

	const start = async () => {
		if (!backend) return
		setStarting(true)
		try {
			const id = await backend.startRun({ mock: true })
			toast.success("Mock run started", { description: "It streams in as the agents work." })
			navigate(`/runs/${encodeURIComponent(id)}/live`)
		} catch (error) {
			toast.error("The run did not start", { description: error instanceof Error ? error.message : String(error) })
		} finally {
			setStarting(false)
		}
	}
	const canStart = backend?.kind === "server"

	return (
		<>
			<TopBar />
			<main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-10 sm:px-6">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold text-ink">Runs</h1>
						<p className="mt-1.5 max-w-xl text-base text-ink-muted">
							Agents read company challenges, profile researchers, pair them, and write proposals. A Critic checks every claim against its
							source.
						</p>
					</div>
					{canStart && (
						<Button variant="primary" onClick={start} disabled={starting}>
							<Play className="fill-current" />
							{starting ? "Starting…" : "Start a mock run"}
						</Button>
					)}
				</div>

				{runs !== null && groups.run === 0 && <SampleIntro canStart={canStart} />}

				<div className="mt-8 flex flex-wrap items-center gap-3">
					<div className="relative w-full sm:w-72">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
						<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a run" className="pl-9" />
					</div>
					<Segmented<Filter>
						aria-label="Which runs"
						className="ml-auto"
						value={filter}
						onValueChange={setFilter}
						items={[
							{ value: "runs", label: <>Runs <Count n={groups.run} /></> },
							{ value: "mock", label: <>Mock <Count n={groups.mock} /></> },
							{ value: "all", label: <>All <Count n={(runs?.length ?? 1) - 1} /></>, title: "Every run folder, with unfinished dev runs" },
						]}
					/>
				</div>

				<div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-panel shadow-card">
					<div className="hidden grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_7rem] gap-4 border-b border-hairline px-5 py-2.5 text-xs text-ink-muted md:grid">
						<span>Run</span>
						<span>Status</span>
						<span className="text-right">Duration</span>
						<span className="text-right">Cost</span>
						<span className="text-right">Started</span>
					</div>
					{runs === null ? (
						Array.from({ length: 4 }, (_, i) => (
							<div key={i} className="border-b border-hairline px-5 py-4 last:border-b-0">
								<Skeleton className="h-4 w-48" />
							</div>
						))
					) : shown.length === 0 ? (
						<EmptyState title={query ? "No run matches" : "Nothing here yet"} className="py-12">
							{query
								? "Try part of the date or the folder name."
								: canStart
									? "Start a mock run above, or run `npm run match` in a terminal. It shows up here as it runs."
									: "This build has no runs of this kind."}
						</EmptyState>
					) : (
						shown.map((run) => <RunRow key={run.id} run={run} showKind={filter === "all"} />)
					)}
				</div>
			</main>
		</>
	)
}

function Count({ n }: { n: number }) {
	return <span className="text-ink-subtle">{n}</span>
}

function RunRow({ run, showKind }: { run: RunInfo; showKind: boolean }) {
	const state = runState(run)
	return (
		<Link
			to={`/runs/${encodeURIComponent(run.id)}`}
			className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-hairline px-5 py-3.5 transition-colors last:border-b-0 hover:bg-hover md:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_7rem]"
		>
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium text-ink">{runLabel(run)}</span>
					{run.sample && <Chip>Example</Chip>}
					{showKind && run.mock && !run.sample && <Chip>Mock</Chip>}
				</div>
				<div className="mt-0.5 truncate font-mono text-xs text-ink-subtle">{run.sample ? "Invented data that shows a full run" : run.id}</div>
			</div>
			<StatusLabel tone={state.tone} pulse={state.pulse} className="text-sm">
				{state.label}
			</StatusLabel>
			<span className="tabular hidden text-right text-sm text-ink-muted md:block">{format.duration(run.durationMs)}</span>
			<span className="tabular hidden text-right text-sm text-ink-muted md:block">{run.costUsd > 0 ? format.usd(run.costUsd) : "—"}</span>
			<span className="hidden text-right text-sm text-ink-muted md:block">{run.sample ? "—" : format.ago(run.startedAt)}</span>
		</Link>
	)
}

/** With no real runs yet, point first at the sample: it shows what a run is in half a minute. */
function SampleIntro({ canStart }: { canStart: boolean }) {
	return (
		<div className="mt-8 grid overflow-hidden rounded-lg border border-hairline bg-panel shadow-card md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
			<div className="flex flex-col justify-center p-6 sm:p-8">
				<h2 className="text-lg font-semibold text-ink">See a whole run in 35 seconds</h2>
				<p className="mt-2 text-base text-ink-muted">
					The sample run has 16 agents working at once on four companies. Watch them overlap, see the Critic send a claim back, and read the
					proposals with their sources.
				</p>
				<div className="mt-6 flex flex-wrap gap-2">
					<Button variant="primary" asChild>
						<Link to="/runs/sample/live?replay&speed=1">
							<Play className="fill-current" />
							Watch the sample
						</Link>
					</Button>
					<Button asChild>
						<Link to="/runs/sample/results">
							Read its proposals
						</Link>
					</Button>
				</div>
				{canStart && (
					<p className="mt-5 text-sm text-ink-subtle">
						Or run your own: <code className="rounded-xs bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-muted">npm run match -- --mock</code>
					</p>
				)}
			</div>
			<SampleLanes className="hidden border-l border-hairline md:block" />
		</div>
	)
}

/** A still picture of agents overlapping: the point of the product in one glance. */
function SampleLanes({ className }: { className?: string }) {
	const lanes: { role: string; bars: [number, number][] }[] = [
		{ role: "analyst", bars: [[4, 30], [6, 33], [5, 36], [7, 40]] },
		{ role: "profiler", bars: [[28, 52], [31, 55], [34, 58], [37, 60]] },
		{ role: "matchmaker", bars: [[50, 62], [60, 71]] },
		{ role: "writer", bars: [[66, 86], [68, 90], [70, 94]] },
		{ role: "critic", bars: [[33, 40], [44, 50], [88, 93], [95, 99]] },
	]
	const rows = lanes.flatMap((lane) => lane.bars.map((bar) => ({ role: lane.role, bar })))
	return (
		<div className={cn("relative bg-sunken px-6 py-7", className)} aria-hidden>
			<svg viewBox={`0 0 100 ${rows.length * 7}`} preserveAspectRatio="none" className="h-52 w-full">
				{rows.map(({ role, bar: [start, end] }, i) => (
					<rect key={i} x={start} y={i * 7 + 1.5} width={end - start} height={4} rx={1} fill={`var(--role-${role})`} opacity={0.9} />
				))}
			</svg>
		</div>
	)
}
