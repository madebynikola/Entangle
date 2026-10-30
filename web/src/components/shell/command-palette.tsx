import {
	FileSearch,
	FlaskConical,
	Gauge,
	Home,
	ListChecks,
	Moon,
	Pause,
	Play,
	Radio,
	RotateCcw,
	Sun,
	SunMoon,
	Zap,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type * as React from "react"
import { useNavigate } from "react-router"
import { create } from "zustand"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { StatusDot } from "@/components/ui/status"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { useBackend, useRuns, useRunStore } from "@/run/hooks"
import { openSource } from "./source"
import { useTheme } from "./theme"
import { runLabel } from "./run-label"

/** A command a screen adds to the palette while it is mounted. */
export interface PaletteCommand {
	id: string
	group: string
	label: string
	icon?: React.ReactNode
	/** Extra words cmdk matches on. */
	keywords?: string[]
	shortcut?: string
	run(): void
}

interface PaletteStore {
	open: boolean
	setOpen(open: boolean): void
	commands: Map<string, PaletteCommand[]>
}

export const usePalette = create<PaletteStore>()((set) => ({
	open: false,
	setOpen: (open) => set({ open }),
	commands: new Map(),
}))

/**
 * Add commands to ⌘K while the calling component is mounted:
 *   useCommands("results", [{ id: "open-p-3", group: "Proposals", label: "Open p-3", run: () => … }])
 */
export function useCommands(owner: string, commands: PaletteCommand[]): void {
	const latest = useRef(commands)
	latest.current = commands
	const key = commands.map((command) => command.id).join("|")
	useEffect(() => {
		usePalette.setState((state) => ({ commands: new Map(state.commands).set(owner, latest.current) }))
		return () =>
			usePalette.setState((state) => {
				const commands = new Map(state.commands)
				commands.delete(owner)
				return { commands }
			})
	}, [owner, key])
}

const SOURCE_ID = /^(R\d{3,4}|C\d{3}(-CH\d+)?|SYN-(PUB|PRJ|PAT)-\d+)$/i

export function CommandPalette() {
	const open = usePalette((state) => state.open)
	const setOpen = usePalette((state) => state.setOpen)
	const extra = usePalette((state) => state.commands)
	const navigate = useNavigate()
	const runs = useRuns()
	const backend = useBackend()
	const runId = useRunStore((state) => state.runId)
	const mode = useRunStore((state) => state.mode)
	const playing = useRunStore((state) => state.playing)
	const runStatus = useRunStore((state) => state.runStatus)
	const theme = useTheme()
	const [query, setQuery] = useState("")
	useEffect(() => {
		if (open) setQuery("")
	}, [open])

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault()
				setOpen(!usePalette.getState().open)
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [setOpen])

	const run = (action: () => void) => () => {
		setOpen(false)
		action()
	}
	const player = useRunStore.getState()
	const id = query.trim().toUpperCase()

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent hideClose className="top-[18%] max-w-xl translate-y-0 overflow-hidden p-0">
				<DialogTitle className="sr-only">Search and commands</DialogTitle>
				<DialogDescription className="sr-only">Go to a run, control the replay, or look up a source by id.</DialogDescription>
				<Command loop>
					<CommandInput value={query} onValueChange={setQuery} placeholder="Go to a run, control the replay, or type a source id…" />
					<CommandList>
						<CommandEmpty>No command matches. Source ids look like R0112, C014-CH1 or SYN-PUB-02211.</CommandEmpty>

						{SOURCE_ID.test(id) && (
							<CommandGroup heading="Source">
								<CommandItem value={`source ${id}`} onSelect={run(() => openSource(id))}>
									<FileSearch />
									Show source <span className="font-mono text-sm">{id}</span>
								</CommandItem>
							</CommandGroup>
						)}

						{runId && (
							<CommandGroup heading="This run">
								<CommandItem value="live view" onSelect={run(() => navigate(`/runs/${runId}/live`))}>
									<Radio />
									Live view
								</CommandItem>
								<CommandItem value="results pairs proposals" onSelect={run(() => navigate(`/runs/${runId}/results`))}>
									<ListChecks />
									Results
								</CommandItem>
								<CommandItem value="play pause" onSelect={run(player.toggle)}>
									{playing && mode === "replay" ? <Pause /> : <Play />}
									{playing || mode === "live" ? "Pause" : "Play"}
									<CommandShortcut>Space</CommandShortcut>
								</CommandItem>
								<CommandItem value="replay from the start restart" onSelect={run(player.restart)}>
									<RotateCcw />
									Replay from the start
								</CommandItem>
								{([1, 4] as const).map((speed) => (
									<CommandItem key={speed} value={`speed ${speed}x`} onSelect={run(() => player.setSpeed(speed))}>
										<Gauge />
										Play at {speed}×
									</CommandItem>
								))}
								<CommandItem value="speed instant skip to end" onSelect={run(() => player.setSpeed("instant"))}>
									<Zap />
									Skip to the end
								</CommandItem>
								{runStatus === "live" && mode !== "live" && (
									<CommandItem value="go live follow" onSelect={run(player.goLive)}>
										<StatusDot tone="working" pulse />
										Follow live
										<CommandShortcut>L</CommandShortcut>
									</CommandItem>
								)}
							</CommandGroup>
						)}

						{[...extra.values()].flat().length > 0 &&
							groupBy([...extra.values()].flat()).map(([group, commands]) => (
								<CommandGroup key={group} heading={group}>
									{commands.map((command) => (
										<CommandItem
											key={command.id}
											value={`${command.label} ${command.keywords?.join(" ") ?? ""}`}
											onSelect={run(command.run)}
										>
											{command.icon}
											{command.label}
											{command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
										</CommandItem>
									))}
								</CommandGroup>
							))}

						<CommandGroup heading="Runs">
							<CommandItem value="home all runs" onSelect={run(() => navigate("/"))}>
								<Home />
								All runs
							</CommandItem>
							{runs?.map((info) => (
								<CommandItem key={info.id} value={`run ${info.id} ${runLabel(info)}`} onSelect={run(() => navigate(`/runs/${info.id}/live`))}>
									<StatusDot tone={info.status === "live" ? "working" : "idle"} pulse={info.status === "live"} className="mx-1" />
									{runLabel(info)}
									<CommandShortcut>{info.sample ? "sample" : format.duration(info.durationMs)}</CommandShortcut>
								</CommandItem>
							))}
							{backend?.kind === "server" && (
								<CommandItem
									value="start a mock run new"
									onSelect={run(async () => {
										try {
											const id = await backend.startRun({ mock: true })
											toast.success("Mock run started", { description: id })
											navigate(`/runs/${id}/live`)
										} catch (error) {
											toast.error("The run did not start", { description: String(error instanceof Error ? error.message : error) })
										}
									})}
								>
									<FlaskConical />
									Start a mock run
								</CommandItem>
							)}
						</CommandGroup>

						<CommandGroup heading="Appearance">
							<CommandItem value="theme light" onSelect={run(() => theme.setTheme("light"))}>
								<Sun />
								Light theme
								{theme.theme === "light" && <CommandShortcut>current</CommandShortcut>}
							</CommandItem>
							<CommandItem value="theme dark" onSelect={run(() => theme.setTheme("dark"))}>
								<Moon />
								Dark theme
								{theme.theme === "dark" && <CommandShortcut>current</CommandShortcut>}
							</CommandItem>
							<CommandItem value="theme system" onSelect={run(() => theme.setTheme("system"))}>
								<SunMoon />
								Match the system
								{theme.theme === "system" && <CommandShortcut>current</CommandShortcut>}
							</CommandItem>
						</CommandGroup>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	)
}

function groupBy(commands: PaletteCommand[]): [string, PaletteCommand[]][] {
	const groups = new Map<string, PaletteCommand[]>()
	for (const command of commands) groups.set(command.group, [...(groups.get(command.group) ?? []), command])
	return [...groups]
}
