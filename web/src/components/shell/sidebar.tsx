import type { RunInfo } from "@shared/server/api"
import { Command, Moon, Plus, Sun } from "lucide-react"
import { useMemo } from "react"
import type * as React from "react"
import { NavLink, useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { RoleSquare } from "@/components/ui/role"
import { StatusDot } from "@/components/ui/status"
import { toast } from "@/components/ui/toaster"
import { Tooltip } from "@/components/ui/tooltip"
import { ROLE_INFO, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { sortAgents, type AgentView } from "@/run/fold"
import { useBackend, useRuns, useRunStore } from "@/run/hooks"
import { usePalette } from "./command-palette"
import { runLabel } from "./run-label"
import { useTheme } from "./theme"

/** With more agents than this, the sidebar lists roles instead of every agent. */
const MAX_LISTED = 18

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<div className="flex h-full min-h-0 flex-col gap-5 px-3 pb-3 pt-4">
			<Brand />
			<RunsSection onNavigate={onNavigate} />
			<AgentsSection />
			<Footer />
		</div>
	)
}

function Brand() {
	return (
		<NavLink to="/" className="flex items-center gap-2.5 rounded-md px-2 py-1">
			<Mark />
			<div className="min-w-0 leading-tight">
				<div className="text-md font-medium text-ink">Entangle</div>
				<div className="truncate text-xs text-ink-muted">EINSTEIN matchmaker</div>
			</div>
		</NavLink>
	)
}

/** Two linked rings: a researcher (profiler teal) and a company (analyst amber). */
export function Mark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 28 28" aria-hidden className={cn("size-7 shrink-0", className)}>
			<circle cx="11" cy="14" r="6" fill="none" stroke="var(--role-profiler)" strokeWidth="2.25" />
			<circle cx="17" cy="14" r="6" fill="none" stroke="var(--role-analyst)" strokeWidth="2.25" />
		</svg>
	)
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
	return (
		<div className="flex h-7 items-center justify-between px-2">
			<h2 className="text-sm text-ink-muted">{title}</h2>
			{action}
		</div>
	)
}

function RunsSection({ onNavigate }: { onNavigate?: () => void }) {
	const runs = useRuns()
	const backend = useBackend()
	const navigate = useNavigate()

	const start = async () => {
		if (!backend) return
		try {
			const id = await backend.startRun({ mock: true })
			toast.success("Mock run started", { description: "It streams in as the agents work." })
			navigate(`/runs/${id}/live`)
			onNavigate?.()
		} catch (error) {
			toast.error("The run did not start", { description: error instanceof Error ? error.message : String(error) })
		}
	}

	return (
		<section className="flex min-h-0 flex-col">
			<SectionHeader
				title="Runs"
				action={
					backend?.kind === "server" && (
						<Tooltip content="Start a mock run (no API keys)">
							<Button variant="quiet" size="icon-sm" onClick={start} aria-label="Start a mock run">
								<Plus />
							</Button>
						</Tooltip>
					)
				}
			/>
			<nav
				className={cn(
					"scrollbar-thin flex max-h-[40dvh] flex-col gap-0.5 overflow-y-auto",
					// A long list fades out at the bottom instead of cutting a row in half.
					(runs?.length ?? 0) > 10 && "pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]",
				)}
			>
				{runs === null
					? Array.from({ length: 3 }, (_, i) => <div key={i} className="mx-2 my-1.5 h-5 rounded-sm bg-hover" />)
					: runs.map((run) => <RunLink key={run.id} run={run} onNavigate={onNavigate} />)}
			</nav>
		</section>
	)
}

function RunLink({ run, onNavigate }: { run: RunInfo; onNavigate?: () => void }) {
	return (
		<NavLink
			to={`/runs/${encodeURIComponent(run.id)}`}
			onClick={onNavigate}
			className={({ isActive }) =>
				cn(
					"group flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2 text-base text-ink transition-colors duration-150",
					isActive ? "bg-selected shadow-[0_0_0_1px_var(--hairline)]" : "hover:bg-hover",
				)
			}
		>
			<StatusDot tone={run.status === "live" ? "working" : run.status === "stalled" ? "needs" : "idle"} pulse={run.status === "live"} />
			<span className="min-w-0 flex-1 truncate">{runLabel(run)}</span>
			{run.sample ? (
				<span className="text-xs text-ink-subtle">sample</span>
			) : run.mock ? (
				<span className="text-xs text-ink-subtle">mock</span>
			) : null}
		</NavLink>
	)
}

function AgentsSection() {
	const runId = useRunStore((state) => state.runId)
	const agents = useRunStore((state) => state.view.agents)
	const sorted = useMemo(() => sortAgents(agents.values()), [agents])
	if (!runId) return <div className="flex-1" />

	return (
		<section className="flex min-h-0 flex-1 flex-col border-t border-hairline pt-4">
			<SectionHeader title="Agents" action={<span className="tabular text-sm text-ink-muted">{sorted.length || ""}</span>} />
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
				{sorted.length === 0 ? (
					<p className="px-2 py-1 text-sm text-ink-subtle">Agents appear as they join.</p>
				) : sorted.length > MAX_LISTED ? (
					<RoleRows agents={sorted} />
				) : (
					sorted.map((agent) => <AgentRow key={agent.id} agent={agent} />)
				)}
			</div>
		</section>
	)
}

function AgentRow({ agent }: { agent: AgentView }) {
	const busy = agent.activity !== "idle"
	return (
		<div className="flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-base" title={ROLE_INFO[agent.role].job || undefined}>
			<RoleSquare role={agent.role} />
			<span className={cn("min-w-0 flex-1 truncate", busy ? "text-ink" : "text-ink-muted")}>{agent.name}</span>
			{agent.sentBack > 0 && (
				<Tooltip content={`Sent back ${agent.sentBack}×`}>
					<span className="tabular text-xs text-needs">↺{agent.sentBack}</span>
				</Tooltip>
			)}
			<StatusDot tone={busy ? "working" : "idle"} pulse={busy} />
		</div>
	)
}

/** One row per role: "■ Profilers 12 · 5 working". */
function RoleRows({ agents }: { agents: AgentView[] }) {
	const roles = new Map<RoleKey, { total: number; busy: number }>()
	for (const agent of agents) {
		const row = roles.get(agent.role) ?? { total: 0, busy: 0 }
		row.total++
		if (agent.activity !== "idle") row.busy++
		roles.set(agent.role, row)
	}
	return [...roles].map(([role, row]) => (
		<div key={role} className="flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-base">
			<RoleSquare role={role} />
			<span className="min-w-0 flex-1 truncate">
				{ROLE_INFO[role].plural} <span className="tabular text-ink-muted">{row.total}</span>
			</span>
			{row.busy > 0 && <span className="tabular text-sm text-working">{row.busy} working</span>}
			<StatusDot tone={row.busy ? "working" : "idle"} pulse={row.busy > 0} />
		</div>
	))
}

function Footer() {
	const backend = useBackend()
	const theme = useTheme()
	const setPalette = usePalette((state) => state.setOpen)
	const dark = theme.resolved === "dark"
	return (
		<div className="flex flex-col gap-1 border-t border-hairline pt-3">
			<button
				type="button"
				onClick={() => setPalette(true)}
				className="flex h-8 items-center gap-2.5 rounded-md px-2 text-base text-ink-muted transition-colors hover:bg-hover hover:text-ink"
			>
				<Command className="size-4" />
				<span className="flex-1 text-left">Search and commands</span>
				<Kbd>⌘K</Kbd>
			</button>
			<div className="flex h-8 items-center gap-2.5 px-2 text-sm text-ink-muted">
				{backend == null ? (
					<StatusDot tone="idle" />
				) : backend.kind === "server" ? (
					<StatusDot tone="working" />
				) : (
					<StatusDot tone="info" />
				)}
				<span className="flex-1 truncate">
					{backend == null ? "Connecting…" : backend.kind === "server" ? "Local server · live runs" : "Static build · replays only"}
				</span>
				<Tooltip content={dark ? "Light theme" : "Dark theme"}>
					<Button variant="quiet" size="icon-sm" onClick={theme.toggle} aria-label="Toggle the theme">
						{dark ? <Sun /> : <Moon />}
					</Button>
				</Tooltip>
			</div>
		</div>
	)
}
