import type { RunInfo } from "@shared/server/api"
import { FlaskConical, Play, Radio } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { runLabel } from "@/components/shell/run-label"
import { Button } from "@/components/ui/button"
import { Card, CardId, CardTitle, Meta } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Status } from "@/components/ui/status"
import { Tabs } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { useBackend, useRuns } from "@/run/hooks"

type Filter = "all" | "live" | "ended"

/** `/`: every run, newest first. */
export function HomeScreen() {
	const runs = useRuns()
	const backend = useBackend()
	const navigate = useNavigate()
	const [filter, setFilter] = useState<Filter>("all")
	const [starting, setStarting] = useState(false)

	const real = runs?.filter((run) => !run.sample) ?? []
	const live = real.filter((run) => run.status === "live")
	const shown = (runs ?? []).filter((run) => filter === "all" || (filter === "live" ? run.status === "live" : run.status !== "live"))

	const start = async () => {
		if (!backend) return
		setStarting(true)
		try {
			const id = await backend.startRun({ mock: true })
			toast.success("Mock run started", { description: "It streams in as the agents work." })
			navigate(`/runs/${id}/live`)
		} catch (error) {
			toast.error("The run did not start", { description: error instanceof Error ? error.message : String(error) })
		} finally {
			setStarting(false)
		}
	}

	return (
		<div className="scrollbar-thin flex-1 overflow-y-auto px-6 pb-10 pt-5">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-xl text-ink">Runs</h1>
					<p className="mt-1 text-sm text-ink-muted">Each run pairs researchers with company challenges and writes proposals.</p>
				</div>
				{backend?.kind === "server" && (
					<Button variant="primary" onClick={start} disabled={starting}>
						<Play className="fill-current" />
						{starting ? "Starting…" : "Start a mock run"}
					</Button>
				)}
			</div>

			<Tabs<Filter>
				className="mt-4"
				aria-label="Filter runs"
				value={filter}
				onValueChange={setFilter}
				items={[
					{ value: "all", label: "All", count: runs?.length ?? "" },
					{ value: "live", label: "Live", count: live.length },
					{ value: "ended", label: "Finished", count: (runs?.length ?? 0) - live.length },
				]}
			/>

			{runs !== null && real.length === 0 && filter !== "live" && (
				<EmptyState
					icon={<Radio />}
					title="No runs yet"
					action={
						<>
							{backend?.kind === "server" && (
								<Button variant="primary" onClick={start} disabled={starting}>
									Start a mock run
								</Button>
							)}
							<Button asChild>
								<Link to="/runs/sample/live">Open the sample run</Link>
							</Button>
						</>
					}
				>
					{backend?.kind === "server" ? (
						<>
							Start one here, or in a terminal with <code className="rounded-xs bg-sunken px-1 font-mono text-sm">npm run match -- --mock</code>. It
							shows up as it runs.
						</>
					) : (
						"This build has no runs. The sample run shows what one looks like."
					)}
				</EmptyState>
			)}

			<div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
				{runs === null
					? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 rounded-md" />)
					: shown.map((run) => <RunCard key={run.id} run={run} />)}
			</div>
			{runs !== null && filter === "live" && live.length === 0 && (
				<p className="mt-2 text-sm text-ink-muted">No run is working right now.</p>
			)}
		</div>
	)
}

function RunCard({ run }: { run: RunInfo }) {
	return (
		<Link to={`/runs/${encodeURIComponent(run.id)}`} className="block rounded-md">
			<Card interactive className="flex h-full flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<CardId className="truncate">{run.id}</CardId>
					{run.sample ? <Chip icon={<FlaskConical />}>Sample data</Chip> : run.mock ? <Chip>Mock model</Chip> : null}
				</div>
				<CardTitle>{runLabel(run)}</CardTitle>
				{run.status === "live" ? (
					<Status tone="working" pulse className="text-sm">
						live · started {format.ago(run.startedAt)}
					</Status>
				) : run.status === "stalled" ? (
					<Status tone="needs" className="text-sm">
						stopped without a summary
					</Status>
				) : (
					<Status tone="idle" className="text-sm">
						finished · ran for {format.duration(run.durationMs)}
					</Status>
				)}
				<Meta
					className="mt-auto"
					items={[
						run.tasks.total > 0 && format.plural(run.tasks.total, "task"),
						run.tasks.failed > 0 && <span className="text-failed">{run.tasks.failed} failed</span>,
						run.tokens > 0 && `${format.tokens(run.tokens)} tokens`,
						run.costUsd > 0 && format.usd(run.costUsd),
						!run.sample && format.ago(run.startedAt),
					]}
				/>
			</Card>
		</Link>
	)
}
