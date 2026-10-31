import type { RunInfo } from "@shared/server/api"
import { Play, Plus, ScanSearch, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "react-router"
import { PageHeader } from "@/components/shell/page-header"
import { runGroup, runLabel, runState, type RunGroup } from "@/components/shell/run-label"
import { useProblemDialog } from "@/components/shell/problem-dialog"
import { useStartRun } from "@/components/shell/start-run"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusLabel } from "@/components/ui/status"
import { Tabs } from "@/components/ui/tabs"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useRuns } from "@/run/hooks"

type Filter = "runs" | "mock" | "all"

const COLUMNS = "md:grid-cols-[minmax(0,1fr)_8rem_6rem_6rem_7rem]"

/**
 * `/`: every run, newest first. Real runs by default; mock and unfinished dev runs one tab away.
 * The table fills the panel and scrolls inside it; its header stays put.
 */
export function HomeScreen() {
	const runs = useRuns()
	const { canStart } = useStartRun()
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
		return inFilter && (!q || `${run.id} ${runLabel(run)} ${run.problem ?? ""} ${run.dataset?.name ?? ""}`.toLowerCase().includes(q))
	})

	return (
		<>
			<PageHeader
				title="Runs"
				actions={
					<>
						<div className="relative hidden w-56 sm:block">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
							<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a run" className="h-8 pl-8 text-sm" />
						</div>
						{canStart && (
							<Button onClick={() => useProblemDialog.getState().setOpen(true)}>
								<ScanSearch />
								Describe a problem
							</Button>
						)}
						<Button variant="primary" asChild>
							<Link to="/new">
								<Plus />
								New run
							</Link>
						</Button>
					</>
				}
				tabs={
					<Tabs<Filter>
						aria-label="Which runs"
						className="border-b-0"
						value={filter}
						onValueChange={setFilter}
						items={[
							{ value: "runs", label: "Runs", count: groups.run + groups.sample },
							{ value: "mock", label: "Mock", count: groups.mock },
							{ value: "all", label: "All", count: runs?.length ?? 0 },
						]}
					/>
				}
			/>

			<div className="flex min-h-0 flex-1 flex-col">
				{runs !== null && groups.run === 0 && <SampleIntro canStart={canStart} />}

				<div className={cn("hidden shrink-0 grid-cols-1 gap-4 border-b border-hairline bg-panel px-6 py-2.5 text-xs text-ink-muted md:grid", COLUMNS)}>
					<span>Run</span>
					<span>Status</span>
					<span className="text-right">Duration</span>
					<span className="text-right">Cost</span>
					<span className="text-right">Started</span>
				</div>
				<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
					{runs === null ? (
						Array.from({ length: 5 }, (_, i) => (
							<div key={i} className="border-b border-hairline px-6 py-4">
								<Skeleton className="h-4 w-48" />
							</div>
						))
					) : shown.length === 0 ? (
						<EmptyState title={query ? "No run matches" : "Nothing here yet"} className="h-full py-12">
							{query
								? "Try part of the date or the folder name."
								: canStart
									? "Start a new run, or run `npm run match` in a terminal. It shows up here as it runs."
									: "This build has no runs of this kind."}
						</EmptyState>
					) : (
						shown.map((run) => <RunRow key={run.id} run={run} showKind={filter === "all"} />)
					)}
				</div>
			</div>
		</>
	)
}

function RunRow({ run, showKind }: { run: RunInfo; showKind: boolean }) {
	const state = runState(run)
	return (
		<Link
			to={`/runs/${encodeURIComponent(run.id)}`}
			className={cn(
				"grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-hairline px-6 py-3 transition-colors hover:bg-hover",
				COLUMNS,
			)}
		>
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium text-ink">{runLabel(run)}</span>
					{run.sample && <Chip>Example</Chip>}
					{run.problem && <Chip>Reverse search</Chip>}
					{run.dataset && (
						<Chip tone={run.dataset.kind === "upload" ? "primary" : "default"} title={run.dataset.kind === "upload" ? "Run on your own data" : "Run on the test fixture"}>
							{run.dataset.name}
						</Chip>
					)}
					{showKind && run.mock && !run.sample && <Chip>Mock</Chip>}
				</div>
				{run.problem ? (
					<div className="mt-0.5 truncate text-sm text-ink-muted" title={run.problem}>
						{run.problem}
					</div>
				) : (
					<div className="mt-0.5 truncate font-mono text-xs text-ink-subtle">{run.sample ? "Invented data that shows a full run" : run.id}</div>
				)}
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
		<div className="grid shrink-0 border-b border-hairline md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<div className="flex flex-col justify-center px-6 py-6">
				<h2 className="text-lg font-semibold text-ink">See a whole run in 35 seconds</h2>
				<p className="mt-1.5 max-w-lg text-base text-ink-muted">
					Agents read company challenges, profile researchers, pair them and write proposals. A Critic checks every claim against its
					source. The sample run shows 16 of them at work at once.
				</p>
				<div className="mt-5 flex flex-wrap items-center gap-2">
					<Button variant="primary" asChild>
						<Link to="/runs/sample/stage?replay&speed=1">
							<Play className="fill-current" />
							Watch the sample
						</Link>
					</Button>
					<Button asChild>
						<Link to="/runs/sample/results">Read its proposals</Link>
					</Button>
					{canStart && (
						<span className="ml-2 hidden text-sm text-ink-subtle xl:inline">
							or <code className="rounded-xs bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-muted">npm run match -- --mock</code>
						</span>
					)}
				</div>
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
		<div className={cn("relative bg-sunken px-6 py-6", className)} aria-hidden>
			<svg viewBox={`0 0 100 ${rows.length * 7}`} preserveAspectRatio="none" className="h-40 w-full">
				{rows.map(({ role, bar: [start, end] }, i) => (
					<rect key={i} x={start} y={i * 7 + 1.5} width={end - start} height={4} rx={1} fill={`var(--role-${role})`} opacity={0.9} />
				))}
			</svg>
		</div>
	)
}
