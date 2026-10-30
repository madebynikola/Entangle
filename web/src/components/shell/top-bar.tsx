import type { RunInfo } from "@shared/server/api"
import { Check, ChevronsUpDown, Moon, Search, Sun } from "lucide-react"
import { useMemo, useState } from "react"
import type * as React from "react"
import { Link, useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { StatusDot } from "@/components/ui/status"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useBackend, useRuns } from "@/run/hooks"
import { usePalette } from "./command-palette"
import { runGroup, runLabel, runState } from "./run-label"
import { useTheme } from "./theme"

/**
 * The sticky header: the mark, where you are (a run switcher inside a run), search and theme.
 * `children` is a second row, such as a run's tabs.
 */
export function TopBar({ run, children }: { run?: RunInfo | null; children?: React.ReactNode }) {
	return (
		<header className="sticky top-0 z-30 border-b border-hairline bg-panel/85 backdrop-blur-md backdrop-saturate-150">
			<div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
				<Link to="/" className="flex shrink-0 items-center gap-2 rounded-md py-1 pr-1">
					<Mark />
					<span className="text-base font-semibold tracking-tight text-ink">Entangle</span>
				</Link>
				{run !== undefined && (
					<>
						<Slash />
						<RunSwitcher current={run} />
					</>
				)}
				<div className="ml-auto flex items-center gap-1.5">
					<StaticBadge />
					<SearchButton />
					<ThemeButton />
				</div>
			</div>
			{children && <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>}
		</header>
	)
}

/** Two linked rings: a researcher (profiler teal) and a company (analyst amber). */
export function Mark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 28 28" aria-hidden className={cn("size-6 shrink-0", className)}>
			<circle cx="11" cy="14" r="6" fill="none" stroke="var(--role-profiler)" strokeWidth="2.5" />
			<circle cx="17" cy="14" r="6" fill="none" stroke="var(--role-analyst)" strokeWidth="2.5" />
		</svg>
	)
}

function Slash() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden className="size-5 shrink-0 text-strong">
			<path d="M16.88 3.55 7.12 20.45" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
		</svg>
	)
}

/** The current run's name; opens a searchable list of runs. */
function RunSwitcher({ current }: { current: RunInfo | null }) {
	const [open, setOpen] = useState(false)
	const runs = useRuns()
	const navigate = useNavigate()
	const shown = useMemo(
		() => (runs ?? []).filter((run) => run.id === current?.id || run.status === "live" || runGroup(run) !== "incomplete").slice(0, 30),
		[runs, current?.id],
	)
	const state = current ? runState(current) : null

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-base font-medium text-ink transition-colors hover:bg-hover"
				>
					{state && <StatusDot tone={state.tone} pulse={state.pulse} />}
					<span className="truncate">{current ? runLabel(current) : "Loading…"}</span>
					<ChevronsUpDown className="size-3.5 shrink-0 text-ink-subtle" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 overflow-hidden p-0">
				<Command loop>
					<CommandInput placeholder="Find a run…" />
					<CommandList>
						<CommandEmpty>No run matches.</CommandEmpty>
						<CommandGroup>
							{shown.map((run) => {
								const s = runState(run)
								return (
									<CommandItem
										key={run.id}
										value={`${run.id} ${runLabel(run)}`}
										onSelect={() => {
											setOpen(false)
											navigate(`/runs/${encodeURIComponent(run.id)}`)
										}}
									>
										<StatusDot tone={s.tone} pulse={s.pulse} className="mx-1" />
										<span className="min-w-0 flex-1 truncate">{runLabel(run)}</span>
										<span className="text-xs text-ink-subtle">
											{run.sample ? "example" : run.mock ? "mock" : format.duration(run.durationMs)}
										</span>
										{run.id === current?.id && <Check className="size-3.5 text-ink" />}
									</CommandItem>
								)
							})}
						</CommandGroup>
					</CommandList>
					<div className="border-t border-hairline p-1.5">
						<Link
							to="/"
							onClick={() => setOpen(false)}
							className="flex h-8 items-center rounded-md px-2.5 text-sm text-ink-muted transition-colors hover:bg-hover hover:text-ink"
						>
							All runs
						</Link>
					</div>
				</Command>
			</PopoverContent>
		</Popover>
	)
}

function SearchButton() {
	const setOpen = usePalette((state) => state.setOpen)
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="hidden h-8 w-56 items-center gap-2 rounded-md border border-hairline bg-panel pl-2.5 pr-1.5 text-sm text-ink-subtle shadow-card transition-colors hover:border-strong md:flex"
			>
				<Search className="size-3.5" />
				<span className="flex-1 text-left">Search or jump to…</span>
				<Kbd>⌘K</Kbd>
			</button>
			<Button variant="quiet" size="icon-sm" className="md:hidden" onClick={() => setOpen(true)} aria-label="Search">
				<Search />
			</Button>
		</>
	)
}

function ThemeButton() {
	const theme = useTheme()
	const dark = theme.resolved === "dark"
	return (
		<Tooltip content={dark ? "Light theme" : "Dark theme"} side="bottom">
			<Button variant="quiet" size="icon-sm" onClick={theme.toggle} aria-label="Toggle the theme">
				{dark ? <Sun /> : <Moon />}
			</Button>
		</Tooltip>
	)
}

/** A hosted build cannot start runs or save approvals; say so once, quietly. */
function StaticBadge() {
	const backend = useBackend()
	if (backend?.kind !== "static") return null
	return (
		<Tooltip content="A hosted build: replays and results, no live runs" side="bottom">
			<span className="mr-1 hidden h-6 items-center rounded-full border border-hairline px-2.5 text-xs text-ink-muted sm:inline-flex">Replay only</span>
		</Tooltip>
	)
}
