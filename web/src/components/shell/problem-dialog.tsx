import { useState } from "react"
import { create } from "zustand"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useBackend } from "@/run/hooks"
import { useStartRun } from "./start-run"

/** Same limits as src/data/problem.ts; the server checks them again. */
const MIN_CHARS = 40
const MAX_CHARS = 6000

const EXAMPLE =
	"Our vibration sensors on wind turbine gearboxes raise false alarms in cold weather. We tried fixed thresholds per season, " +
	"but bearing faults are still missed in winter. We have two years of labelled vibration data from 40 turbines and one engineer " +
	"who can work on it two days a week."

/** Open the reverse search from anywhere: the Runs header, or ⌘K. */
export const useProblemDialog = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
	open: false,
	setOpen: (open) => set({ open }),
}))

/**
 * Reverse search: a company describes one problem, and a run finds researchers for it. The run is the normal one
 * on a single described challenge, so it streams in on the Stage like any other. Local server only.
 */
export function ProblemDialog() {
	const { open, setOpen } = useProblemDialog()
	const backend = useBackend()
	const { canStart, starting, start } = useStartRun()
	const [text, setText] = useState("")
	const [sector, setSector] = useState("")
	const canRunReal = backend?.health?.hasKeys ?? false
	const [mock, setMock] = useState(true)
	const useMock = mock || !canRunReal
	const length = text.trim().length
	const ready = length >= MIN_CHARS && length <= MAX_CHARS

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!ready || starting) return
		const started = await start({ mock: useMock, problem: text.trim(), sector: sector.trim() || undefined })
		if (started) {
			setOpen(false)
			setText("")
			setSector("")
		}
	}

	if (!canStart) return null
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="max-w-xl">
				<DialogTitle>Find researchers for a problem</DialogTitle>
				<DialogDescription>
					Describe one problem as a company would: what goes wrong, what you tried, what you have. The agents search the university's
					publications, projects and patents, profile who fits, and write a proposal for the best pair. A Critic checks every claim.
				</DialogDescription>
				<form onSubmit={submit} className="mt-5 flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<div className="flex items-baseline justify-between">
							<label htmlFor="problem-text" className="text-sm font-medium text-ink">
								The problem
							</label>
							<button type="button" onClick={() => setText(EXAMPLE)} className="text-sm text-ink-muted hover:text-ink">
								Use an example
							</button>
						</div>
						<textarea
							id="problem-text"
							autoFocus
							value={text}
							onChange={(event) => setText(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event)
							}}
							rows={7}
							maxLength={MAX_CHARS}
							placeholder="Our … fails when … We tried … We have …"
							className="scrollbar-thin w-full resize-none rounded-md border border-hairline bg-panel px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-ink-subtle hover:border-strong focus-visible:border-link focus-visible:ring-3 focus-visible:ring-link/15"
						/>
						<span className="tabular text-xs text-ink-subtle">
							{length < MIN_CHARS ? `${MIN_CHARS - length} more characters to start` : `${length.toLocaleString("en")} characters`}
						</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="problem-sector" className="text-sm font-medium text-ink">
							Sector <span className="font-normal text-ink-subtle">(optional, helps the Funding Scout)</span>
						</label>
						<Input id="problem-sector" value={sector} onChange={(event) => setSector(event.target.value)} maxLength={100} placeholder="Renewable energy" />
					</div>
					<div className="flex items-center justify-between gap-4 rounded-md bg-sunken px-3 py-2.5">
						<div className="min-w-0">
							<div className="text-sm font-medium text-ink">Mock model</div>
							<div className="text-sm text-ink-muted">
								{!canRunReal
									? "The server has no API key, so only the mock can run."
									: useMock
										? "Canned answers in seconds, no cost. Turn off to run the real models."
										: "Real models: it takes several minutes and spends API credit."}
							</div>
						</div>
						<Switch checked={useMock} onCheckedChange={setMock} disabled={!canRunReal} aria-label="Run on the mock model" />
					</div>
					<p className="text-sm text-ink-subtle">
						Pairs, not people: each fit is for this problem only. Nobody is contacted until a coordinator approves the pair.
					</p>
					<div className="flex justify-end gap-2">
						<Button variant="quiet" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" disabled={!ready || starting}>
							{starting ? "Starting…" : "Find researchers"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
