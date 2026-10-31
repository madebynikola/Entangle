import type { RunInfo } from "@shared/server/api"
import { LayoutList, Moon, PanelLeft, Plus, Search, Sun } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useEffect, useMemo } from "react"
import type * as React from "react"
import { Link, NavLink, useMatch } from "react-router"
import { create } from "zustand"
import { Button } from "@/components/ui/button"
import { RoleFace } from "@/components/ui/face"
import { Kbd } from "@/components/ui/kbd"
import { StatusDot } from "@/components/ui/status"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { ROLE_CLASS, ROLE_INFO, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"
import { sortAgents } from "@/run/fold"
import { useBackend, useRuns, useRunStore } from "@/run/hooks"
import { usePalette } from "./command-palette"
import { runGroup, runLabel, runState } from "./run-label"
import { useStartRun } from "./start-run"
import { useTheme } from "./theme"

const STORAGE_KEY = "entangle.sidebar"
const WIDE = "(min-width: 1024px)"

interface SidebarStore {
	/** Shown beside the panel on wide screens. Remembered. */
	open: boolean
	/** The drawer on narrow screens. */
	drawer: boolean
	toggle(): void
	setDrawer(open: boolean): void
}

export const useSidebar = create<SidebarStore>()((set, get) => ({
	open: read(),
	drawer: false,
	toggle: () => {
		if (!window.matchMedia(WIDE).matches) return set({ drawer: !get().drawer })
		const open = !get().open
		try {
			localStorage.setItem(STORAGE_KEY, open ? "open" : "closed")
		} catch {}
		set({ open })
	},
	setDrawer: (drawer) => set({ drawer }),
}))

function read(): boolean {
	try {
		return localStorage.getItem(STORAGE_KEY) !== "closed"
	} catch {
		return true
	}
}

/** ⌘B (Ctrl+B) shows or hides the sidebar. */
export function useSidebarKeys() {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
				event.preventDefault()
				useSidebar.getState().toggle()
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])
}

/** The button that shows or hides the sidebar. In the page header it appears only while the sidebar is away. */
export function SidebarToggle({ className }: { className?: string }) {
	const toggle = useSidebar((state) => state.toggle)
	return (
		<Tooltip content={<>Sidebar <Kbd className="ml-1">⌘B</Kbd></>} side="bottom">
			<Button variant="quiet" size="icon-sm" onClick={toggle} aria-label="Show or hide the sidebar" className={className}>
				<PanelLeft />
			</Button>
		</Tooltip>
	)
}

/** The narrow-screen drawer: the same sidebar, over the panel. */
export function SidebarDrawer() {
	const drawer = useSidebar((state) => state.drawer)
	const setDrawer = useSidebar((state) => state.setDrawer)
	return (
		<DialogPrimitive.Root open={drawer} onOpenChange={setDrawer}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-canvas shadow-float outline-none data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in"
				>
					<DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
					<Sidebar onNavigate={() => setDrawer(false)} />
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	)
}

/**
 * The left column on the grey canvas: search, the runs, the open run's agents by role, and where the data comes from.
 * It lists only what helps you move: live runs, finished real runs and the sample. Every other run is one click away.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
	return (
		<div className="flex h-full min-h-0 flex-col gap-4 px-3 pb-3 pt-3">
			<div className="flex h-9 shrink-0 items-center gap-1 pl-2">
				<Link to="/" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2 rounded-md">
					<Mark />
					<span className="truncate text-md font-semibold tracking-tight text-ink">Entangle</span>
				</Link>
				<SidebarToggle className="hidden lg:inline-flex" />
			</div>
			<SearchRow onNavigate={onNavigate} />
			<RunsSection onNavigate={onNavigate} />
			<AgentsSection />
			<Footer />
		</div>
	)
}

/** The Entangle mark (design/logo): a 3×3 grid with an empty centre and one indigo tile, in the theme's ink and accent. */
export function Mark({ className }: { className?: string }) {
	const tiles = [
		[19, 19],
		[41, 19],
		[19, 41],
		[63, 41],
		[19, 63],
		[41, 63],
		[63, 63],
	]
	return (
		<svg viewBox="17 17 66 66" aria-hidden className={cn("size-5 shrink-0", className)}>
			{tiles.map(([x, y]) => (
				<rect key={`${x}-${y}`} x={x} y={y} width="18" height="18" rx="4" fill="var(--ink)" />
			))}
			<rect x="63" y="19" width="18" height="18" rx="4" fill="var(--link)" />
		</svg>
	)
}

function SearchRow({ onNavigate }: { onNavigate?: () => void }) {
	const setOpen = usePalette((state) => state.setOpen)
	return (
		<button
			type="button"
			onClick={() => {
				onNavigate?.()
				setOpen(true)
			}}
			className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-hairline bg-panel pl-2.5 pr-1.5 text-sm text-ink-subtle shadow-card transition-colors hover:border-strong hover:text-ink-muted"
		>
			<Search className="size-3.5" />
			<span className="flex-1 text-left">Search or jump to…</span>
			<Kbd>⌘K</Kbd>
		</button>
	)
}

function SectionHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
	return (
		<div className="flex h-7 shrink-0 items-center justify-between gap-2 pl-2">
			<h2 className="text-sm text-ink-muted">{title}</h2>
			{children}
		</div>
	)
}

/** The row look shared by runs and links: a white pill with a hairline when selected, as in Kanbix. */
const rowClass = (active: boolean) =>
	cn(
		"flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-base transition-colors duration-150",
		active ? "bg-panel text-ink shadow-[0_0_0_1px_var(--hairline),0_1px_2px_#0000000a]" : "text-ink-muted hover:bg-hover hover:text-ink",
	)

function RunsSection({ onNavigate }: { onNavigate?: () => void }) {
	const runs = useRuns()
	const current = useMatch("/runs/:runId/*")?.params.runId
	const { canStart, starting, start } = useStartRun()
	const listed = useMemo(() => {
		const all = runs ?? []
		const live = all.filter((run) => run.status === "live")
		const rest = all.filter((run) => run.status !== "live" && (runGroup(run) === "run" || runGroup(run) === "sample" || run.id === current))
		return [...live, ...rest]
	}, [runs, current])

	return (
		<section className="flex min-h-0 shrink flex-col">
			<SectionHeader title="Runs">
				{canStart && (
					<Tooltip content="Start a mock run (no API keys)">
						<Button variant="quiet" size="icon-sm" onClick={() => start()} disabled={starting} aria-label="Start a mock run">
							<Plus />
						</Button>
					</Tooltip>
				)}
			</SectionHeader>
			<nav className="scrollbar-thin -mx-1 flex min-h-0 flex-col gap-px overflow-y-auto px-1 py-px">
				{runs === null
					? Array.from({ length: 3 }, (_, i) => <div key={i} className="mx-2 my-1.5 h-5 shrink-0 animate-shimmer rounded-sm bg-hover" />)
					: listed.map((run) => <RunRow key={run.id} run={run} onNavigate={onNavigate} />)}
				<NavLink to="/" end onClick={onNavigate} className={({ isActive }) => rowClass(isActive)}>
					<LayoutList className="size-4 text-ink-subtle" />
					<span className="flex-1">All runs</span>
					{runs && <span className="tabular text-xs text-ink-subtle">{runs.length}</span>}
				</NavLink>
			</nav>
		</section>
	)
}

function RunRow({ run, onNavigate }: { run: RunInfo; onNavigate?: () => void }) {
	const state = runState(run)
	return (
		<NavLink to={`/runs/${encodeURIComponent(run.id)}`} onClick={onNavigate} className={({ isActive }) => rowClass(isActive)}>
			<span className="flex size-4 items-center justify-center">
				<StatusDot tone={state.tone} pulse={state.pulse} />
			</span>
			<span className="min-w-0 flex-1 truncate">{runLabel(run)}</span>
			<span className={cn("tabular shrink-0 text-xs", run.status === "live" ? "text-working" : "text-ink-subtle")}>
				{run.status === "live" ? "live" : run.sample ? "example" : format.duration(run.durationMs)}
			</span>
		</NavLink>
	)
}

/** Up to this many agents of one role show as pips; more show as a number. */
const MAX_PIPS = 14

/**
 * The open run's team, one row per role, with the role's face (it works while any of them works).
 * Each agent is a pip that lights up while it works,
 * so a glance shows how many agents run at the same time. It follows the replay.
 */
function AgentsSection() {
	const inRun = useMatch("/runs/:runId/*") != null
	const agents = useRunStore((state) => state.view.agents)
	const roles = useMemo(() => {
		const rows = new Map<RoleKey, { total: number; busy: number }>()
		for (const agent of sortAgents(agents.values())) {
			const row = rows.get(agent.role) ?? { total: 0, busy: 0 }
			row.total++
			if (agent.activity !== "idle") row.busy++
			rows.set(agent.role, row)
		}
		return [...rows]
	}, [agents])
	const busy = roles.reduce((sum, [, row]) => sum + row.busy, 0)

	if (!inRun) return <div className="flex-1" />
	return (
		<section className="flex min-h-0 flex-1 flex-col border-t border-hairline pt-3">
			<SectionHeader title="Agents">
				<span className={cn("tabular pr-2 text-xs", busy ? "text-working" : "text-ink-subtle")}>
					{busy ? `${busy} working` : agents.size || ""}
				</span>
			</SectionHeader>
			<div className="scrollbar-thin flex min-h-0 flex-col gap-px overflow-y-auto">
				{roles.length === 0 ? (
					<p className="px-2 py-1 text-sm text-ink-subtle">Agents appear here as they join.</p>
				) : (
					roles.map(([role, row]) => (
						<Tooltip
							key={role}
							side="right"
							content={`${ROLE_INFO[role].name ? `${ROLE_INFO[role].name}, ${ROLE_INFO[role].label}. ` : ""}${row.busy} of ${row.total} working. ${ROLE_INFO[role].job}`}
						>
							<div className="flex h-8 shrink-0 items-center gap-2 rounded-md pl-1 pr-2 text-base">
								<RoleFace role={role} state={row.busy ? "working" : "idle"} className="size-6" />
								<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
									{ROLE_INFO[role].name && <span className="shrink-0 font-medium text-ink">{ROLE_INFO[role].name}</span>}
									<span className={cn("truncate text-sm transition-colors", row.busy ? "text-ink-muted" : "text-ink-subtle")}>
										{ROLE_INFO[role].plural}
									</span>
								</span>
								<Pips role={role} total={row.total} busy={row.busy} />
							</div>
						</Tooltip>
					))
				)}
			</div>
		</section>
	)
}

function Pips({ role, total, busy }: { role: RoleKey; total: number; busy: number }) {
	if (total > MAX_PIPS) {
		return (
			<span className="tabular text-xs text-ink-subtle">
				<span className={busy ? ROLE_CLASS[role].text : undefined}>{busy}</span> / {total}
			</span>
		)
	}
	return (
		<span className="flex shrink-0 items-center gap-[3px]" aria-label={`${busy} of ${total} working`}>
			{Array.from({ length: total }, (_, i) => (
				<span
					key={i}
					className={cn("size-[7px] rounded-[2px] transition-colors duration-300", i < busy ? ROLE_CLASS[role].bg : "bg-strong/70")}
				/>
			))}
		</span>
	)
}

function Footer() {
	const backend = useBackend()
	const theme = useTheme()
	const dark = theme.resolved === "dark"
	const where =
		backend == null
			? { tone: "idle" as const, text: "Connecting…", hint: "" }
			: backend.kind === "server"
				? { tone: "working" as const, text: "Local server", hint: "Live runs, replays and approvals on this machine." }
				: { tone: "info" as const, text: "Hosted replay", hint: "A static build: replays and results. Approvals stay in this browser." }
	return (
		<div className="flex h-8 shrink-0 items-center gap-2.5 border-t border-hairline pl-2 pt-3 text-sm text-ink-muted">
			<Tooltip content={where.hint || where.text} side="top">
				<span className="flex min-w-0 flex-1 items-center gap-2.5">
					<span className="flex size-4 items-center justify-center">
						<StatusDot tone={where.tone} />
					</span>
					<span className="truncate">{where.text}</span>
				</span>
			</Tooltip>
			<Tooltip content={dark ? "Light theme" : "Dark theme"} side="top">
				<Button variant="quiet" size="icon-sm" onClick={theme.toggle} aria-label="Toggle the theme">
					{dark ? <Sun /> : <Moon />}
				</Button>
			</Tooltip>
		</div>
	)
}
