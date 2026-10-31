import type { CompanyInfo, DatasetInfo, StartRunBody } from "@shared/server/api"
import { Check, Database, Plus, Search, Terminal, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type * as React from "react"
import { Link, useSearchParams } from "react-router"
import { PageHeader } from "@/components/shell/page-header"
import { useStartRun } from "@/components/shell/start-run"
import { Button } from "@/components/ui/button"
import { Pane } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { EmptyState } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toaster"
import { Tooltip } from "@/components/ui/tooltip"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import { useBackend } from "@/run/hooks"
import { UploadDialog } from "./upload-dialog"

type Mode = "problem" | "companies"

/** Same limits as src/data/problem.ts; the server checks them again. */
const MIN_CHARS = 40
const MAX_CHARS = 6000
/** The CLI's default: the first 5 companies. */
const FIRST = 5

const EXAMPLE =
	"Our vibration sensors on wind turbine gearboxes raise false alarms in cold weather. We tried fixed thresholds per season, " +
	"but bearing faults are still missed in winter. We have two years of labelled vibration data from 40 turbines and one engineer " +
	"who can work on it two days a week."

/**
 * `/new`: start a run from the app, on any data. Pick the data (the EINSTEIN dataset, the test fixture, or your own upload),
 * then what to match (a described problem, or companies from that data), then the model. It starts the same
 * `npm run match` the CLI runs and opens it on the Stage. Local server only: a hosted build says how to get one.
 */
export function NewRunScreen() {
	const backend = useBackend()
	return (
		<>
			<PageHeader title="New run" meta={<span className="text-sm text-ink-muted">Find researchers for a problem, or for companies, on any data</span>} />
			{backend == null ? (
				<div className="p-6">
					<Skeleton className="h-40 w-full" />
				</div>
			) : backend.kind === "static" ? (
				<HostedNotice />
			) : (
				<NewRunForm />
			)}
		</>
	)
}

function NewRunForm() {
	const backend = useBackend()!
	const [params, setParams] = useSearchParams()
	const { starting, start } = useStartRun()

	const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null)
	const [loadError, setLoadError] = useState<string | null>(null)
	const datasetId = params.get("data") ?? datasets?.find((d) => d.default)?.id ?? null
	const dataset = datasets?.find((d) => d.id === datasetId) ?? null
	const mode: Mode = params.get("mode") === "companies" ? "companies" : "problem"
	const setParam = (key: string, value: string | null) =>
		setParams(
			(current) => {
				const next = new URLSearchParams(current)
				if (value == null) next.delete(key)
				else next.set(key, value)
				return next
			},
			{ replace: true },
		)

	const [uploadOpen, setUploadOpen] = useState(false)
	const [text, setText] = useState("")
	const [sector, setSector] = useState("")
	const [companies, setCompanies] = useState<CompanyInfo[] | null>(null)
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [canRunReal, setCanRunReal] = useState(backend.health?.hasKeys ?? false)
	const [mock, setMock] = useState(true)
	const [k, setK] = useState("")
	const [proposals, setProposals] = useState("")

	const reload = async () => {
		try {
			setDatasets(await backend.listDatasets())
			setLoadError(null)
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error))
		}
	}
	useEffect(() => {
		void reload()
		setCanRunReal(backend.health?.hasKeys ?? false)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [backend])

	// The chosen data's companies, with the first five ticked, as the CLI picks them.
	useEffect(() => {
		if (!datasetId) return
		let live = true
		setCompanies(null)
		backend
			.listCompanies(datasetId)
			.then((list) => {
				if (!live) return
				setCompanies(list)
				setSelected(new Set(list.slice(0, FIRST).map((c) => c.id)))
			})
			.catch(() => live && setCompanies([]))
		return () => {
			live = false
		}
	}, [backend, datasetId])

	const length = text.trim().length
	const chosen = (companies ?? []).filter((c) => selected.has(c.id))
	const challenges = chosen.reduce((sum, c) => sum + c.challenges.length, 0)
	const useMock = mock || !canRunReal
	const kValue = parseWhole(k)
	const proposalsValue = parseWhole(proposals)
	const ready =
		dataset != null &&
		(mode === "problem" ? length >= MIN_CHARS && length <= MAX_CHARS : chosen.length > 0) &&
		kValue !== false &&
		proposalsValue !== false

	const submit = async () => {
		if (!ready || starting || !dataset) return
		const body: StartRunBody = {
			mock: useMock,
			dataset: dataset.id,
			...(kValue ? { k: kValue } : {}),
			...(proposalsValue ? { proposals: proposalsValue } : {}),
			...(mode === "problem" ? { problem: text.trim(), sector: sector.trim() || undefined } : { ids: chosen.map((c) => c.id) }),
		}
		await start(body)
	}

	const remove = async (target: DatasetInfo) => {
		try {
			await backend.deleteDataset(target.id)
			toast.success(`Removed ${target.name}`, { description: "Its files are gone from data/uploads/. Runs on it keep their results." })
			if (datasetId === target.id) setParam("data", null)
			await reload()
		} catch (error) {
			toast.error("Could not remove it", { description: error instanceof Error ? error.message : String(error) })
		}
	}

	if (loadError) {
		return (
			<EmptyState title="The data list did not load" action={<Button onClick={reload}>Try again</Button>} className="h-full">
				{loadError}
			</EmptyState>
		)
	}

	return (
		// Wide: two columns that fit the panel, lists scroll inside. Narrow: one column that scrolls, each part at its own height.
		<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:overflow-hidden">
			<div className="flex shrink-0 flex-col gap-4 lg:min-h-0">
				<Pane
					title="Data"
					description="The researchers and companies the agents read"
					className="shrink-0 lg:max-h-[40%]"
					scroll
					action={
						<Button size="sm" onClick={() => setUploadOpen(true)}>
							<Plus />
							Add your own data
						</Button>
					}
				>
					<DatasetList datasets={datasets} value={datasetId} onChange={(id) => setParam("data", id)} onRemove={remove} />
				</Pane>

				<Pane
					title="Find researchers for"
					className="h-[30rem] shrink-0 lg:h-auto lg:min-h-[20rem] lg:flex-1 lg:shrink"
					action={
						<Segmented<Mode>
							aria-label="What to match"
							value={mode}
							onValueChange={(value) => setParam("mode", value === "problem" ? null : value)}
							items={[
								{ value: "problem", label: "A problem" },
								{ value: "companies", label: "Companies" },
							]}
						/>
					}
					bodyClassName="flex flex-col"
				>
					{mode === "problem" ? (
						<ProblemForm text={text} setText={setText} sector={sector} setSector={setSector} onSubmit={submit} />
					) : (
						<CompanyPicker
							companies={companies}
							selected={selected}
							setSelected={setSelected}
							datasetName={dataset?.name}
							onDescribe={() => setParam("mode", null)}
						/>
					)}
				</Pane>
			</div>

			<RunPanel
				dataset={dataset}
				mode={mode}
				problemLength={length}
				companies={chosen.length}
				challenges={challenges}
				canRunReal={canRunReal}
				useMock={useMock}
				setMock={setMock}
				k={k}
				setK={setK}
				kInvalid={kValue === false}
				proposals={proposals}
				setProposals={setProposals}
				proposalsInvalid={proposalsValue === false}
				ready={ready}
				starting={starting}
				onStart={submit}
			/>

			<UploadDialog
				open={uploadOpen}
				onOpenChange={setUploadOpen}
				onUploaded={async (added) => {
					await reload()
					setParam("data", added.id)
					const renamed = Object.keys(added.renamed ?? {}).length
					toast.success(`Added ${added.name}`, {
						description:
							`${count(added.counts.researchers, "researcher")}, ${count(added.counts.publications, "publication")}, ` +
							`${count(added.counts.companies, "company", "companies")}.` +
							(renamed ? ` ${count(renamed, "id")} got the dataset's shape.` : "") +
							(added.warnings?.length ? ` ${added.warnings.join(" ")}` : ""),
					})
				}}
			/>
		</div>
	)
}

/** "1,043 researchers", "1 company". */
function count(n: number, one: string, many = `${one}s`): string {
	return `${n.toLocaleString("en")} ${n === 1 ? one : many}`
}

/** "" → undefined (the default), a whole number from 1 to 20 → it, anything else → false. */
function parseWhole(value: string): number | undefined | false {
	if (!value.trim()) return undefined
	const n = Number(value)
	return Number.isInteger(n) && n >= 1 && n <= 20 ? n : false
}

// ---------------------------------------------------------------------------

function DatasetList({
	datasets,
	value,
	onChange,
	onRemove,
}: {
	datasets: DatasetInfo[] | null
	value: string | null
	onChange(id: string): void
	onRemove(dataset: DatasetInfo): void
}) {
	if (!datasets) {
		return (
			<div className="flex flex-col gap-3 p-4">
				<Skeleton className="h-4 w-64" />
				<Skeleton className="h-4 w-48" />
			</div>
		)
	}
	return (
		<div role="radiogroup" aria-label="Data" className="flex flex-col divide-y divide-hairline">
			{datasets.map((dataset) => (
				<DatasetRow key={dataset.id} dataset={dataset} active={dataset.id === value} onSelect={() => onChange(dataset.id)} onRemove={() => onRemove(dataset)} />
			))}
		</div>
	)
}

function DatasetRow({ dataset, active, onSelect, onRemove }: { dataset: DatasetInfo; active: boolean; onSelect(): void; onRemove(): void }) {
	const [confirming, setConfirming] = useState(false)
	const { counts } = dataset
	const renamed = Object.keys(dataset.renamed ?? {}).length
	const facts = [
		count(counts.researchers, "researcher"),
		count(counts.publications, "publication"),
		counts.projects ? count(counts.projects, "project") : null,
		count(counts.companies, "company", "companies"),
		count(counts.challenges, "challenge"),
	].filter(Boolean)
	return (
		<div className={cn("group flex items-center gap-3 pr-2 transition-colors", active ? "bg-primary-soft" : "hover:bg-hover")}>
			<button type="button" role="radio" aria-checked={active} onClick={onSelect} className="flex min-w-0 flex-1 items-start gap-3 py-2.5 pl-4 text-left">
				<span
					className={cn(
						"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
						active ? "border-ink bg-ink" : "border-strong bg-panel",
					)}
				>
					{active && <span className="size-1.5 rounded-full bg-panel" />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<span className="truncate font-medium text-ink">{dataset.name}</span>
						{dataset.kind === "upload" && <Chip tone="primary">Your data</Chip>}
						{dataset.default && <Chip>Default</Chip>}
					</span>
					<span className="tabular mt-0.5 block truncate text-sm text-ink-muted">
						{facts.join(" · ")}
						{dataset.kind === "upload" && dataset.createdAt ? ` · added ${format.ago(dataset.createdAt)}` : ""}
					</span>
					{(renamed > 0 || (dataset.warnings?.length ?? 0) > 0) && (
						<span className="mt-0.5 block truncate text-xs text-ink-subtle" title={[...(dataset.warnings ?? []), ...renamedLines(dataset)].join("\n")}>
							{[renamed ? `${count(renamed, "id")} renamed to the dataset's shape` : null, ...(dataset.warnings ?? [])].filter(Boolean).join(" · ")}
						</span>
					)}
				</span>
			</button>
			{dataset.kind === "upload" &&
				(confirming ? (
					<span className="flex shrink-0 items-center gap-1">
						<Button variant="danger" size="sm" onClick={onRemove}>
							Remove
						</Button>
						<Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
							Keep
						</Button>
					</span>
				) : (
					<Tooltip content="Remove this upload">
						<Button
							variant="quiet"
							size="icon-sm"
							aria-label={`Remove ${dataset.name}`}
							onClick={() => setConfirming(true)}
							className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
						>
							<Trash2 />
						</Button>
					</Tooltip>
				))}
		</div>
	)
}

function renamedLines(dataset: DatasetInfo): string[] {
	const entries = Object.entries(dataset.renamed ?? {})
	const lines = entries.slice(0, 12).map(([from, to]) => `${from} → ${to}`)
	if (entries.length > 12) lines.push(`and ${entries.length - 12} more`)
	return lines
}

// ---------------------------------------------------------------------------

function ProblemForm({
	text,
	setText,
	sector,
	setSector,
	onSubmit,
}: {
	text: string
	setText(text: string): void
	sector: string
	setSector(sector: string): void
	onSubmit(): void
}) {
	const length = text.trim().length
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
			<div className="flex min-h-0 flex-1 flex-col gap-1.5">
				<div className="flex items-baseline justify-between">
					<label htmlFor="new-problem" className="text-sm font-medium text-ink">
						The problem
					</label>
					<button type="button" onClick={() => setText(EXAMPLE)} className="text-sm text-ink-muted hover:text-ink">
						Use an example
					</button>
				</div>
				<textarea
					id="new-problem"
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSubmit()
					}}
					maxLength={MAX_CHARS}
					placeholder="Describe one problem as a company would: what goes wrong, what you tried, what you have. Our … fails when … We tried … We have …"
					className="scrollbar-thin min-h-32 w-full flex-1 resize-none rounded-md border border-hairline bg-panel px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-ink-subtle hover:border-strong focus-visible:border-link focus-visible:ring-3 focus-visible:ring-link/15"
				/>
				<span className="tabular text-xs text-ink-subtle">
					{length < MIN_CHARS ? `${MIN_CHARS - length} more characters to start` : `${length.toLocaleString("en")} characters · ⌘↵ to start`}
				</span>
			</div>
			<div className="flex shrink-0 flex-col gap-1.5">
				<label htmlFor="new-sector" className="text-sm font-medium text-ink">
					Sector <span className="font-normal text-ink-subtle">(optional, helps the Funding Scout)</span>
				</label>
				<Input id="new-sector" value={sector} onChange={(event) => setSector(event.target.value)} maxLength={100} placeholder="Renewable energy" />
			</div>
		</div>
	)
}

function CompanyPicker({
	companies,
	selected,
	setSelected,
	datasetName,
	onDescribe,
}: {
	companies: CompanyInfo[] | null
	selected: Set<string>
	setSelected(next: Set<string>): void
	datasetName?: string
	onDescribe(): void
}) {
	const [query, setQuery] = useState("")
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!companies || !q) return companies ?? []
		return companies.filter((c) => `${c.id} ${c.name} ${c.sector} ${c.challenges.map((ch) => ch.text).join(" ")}`.toLowerCase().includes(q))
	}, [companies, query])

	if (companies === null) {
		return (
			<div className="flex flex-col gap-3 p-4">
				{Array.from({ length: 4 }, (_, i) => (
					<Skeleton key={i} className="h-4 w-72" />
				))}
			</div>
		)
	}
	if (!companies.length) {
		return (
			<EmptyState
				icon={<Database />}
				title="This data has no companies"
				className="flex-1"
				action={<Button onClick={onDescribe}>Describe a problem instead</Button>}
			>
				{datasetName ?? "It"} has researchers only. Describe a problem to search them, or add a companies.json to your upload.
			</EmptyState>
		)
	}
	const toggle = (id: string) => {
		const next = new Set(selected)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		setSelected(next)
	}
	return (
		<>
			<div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2.5">
				<div className="relative min-w-0 flex-1">
					<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
					<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a company, sector or challenge" className="h-8 pl-8 text-sm" />
				</div>
				<span className="tabular shrink-0 text-sm text-ink-muted">
					{selected.size} of {companies.length}
				</span>
				<Button variant="quiet" size="sm" onClick={() => setSelected(new Set(companies.slice(0, FIRST).map((c) => c.id)))}>
					First {Math.min(FIRST, companies.length)}
				</Button>
				<Button variant="quiet" size="sm" onClick={() => setSelected(new Set())} disabled={!selected.size}>
					Clear
				</Button>
			</div>
			<div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" role="group" aria-label="Companies">
				{shown.length === 0 ? (
					<p className="px-4 py-6 text-sm text-ink-muted">No company matches.</p>
				) : (
					shown.map((company) => {
						const on = selected.has(company.id)
						return (
							<button
								key={company.id}
								type="button"
								role="checkbox"
								aria-checked={on}
								onClick={() => toggle(company.id)}
								className={cn("flex w-full items-start gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors", on ? "bg-primary-soft" : "hover:bg-hover")}
							>
								<span
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
										on ? "border-ink bg-ink text-panel" : "border-strong bg-panel",
									)}
								>
									{on && <Check className="size-3" strokeWidth={3} />}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-baseline gap-2">
										<span className="truncate font-medium text-ink">{company.name}</span>
										<span className="shrink-0 text-xs text-ink-subtle">{company.id}</span>
									</span>
									<span className="mt-0.5 block truncate text-sm text-ink-muted">
										{[company.sector, count(company.challenges.length, "challenge")].filter(Boolean).join(" · ")}
										{company.challenges[0] ? ` · ${company.challenges[0].text}` : ""}
									</span>
								</span>
							</button>
						)
					})
				)}
			</div>
		</>
	)
}

// ---------------------------------------------------------------------------

function RunPanel(props: {
	dataset: DatasetInfo | null
	mode: Mode
	problemLength: number
	companies: number
	challenges: number
	canRunReal: boolean
	useMock: boolean
	setMock(mock: boolean): void
	k: string
	setK(k: string): void
	kInvalid: boolean
	proposals: string
	setProposals(proposals: string): void
	proposalsInvalid: boolean
	ready: boolean
	starting: boolean
	onStart(): void
}) {
	const { dataset, mode, useMock } = props
	const work =
		mode === "problem"
			? props.problemLength >= MIN_CHARS
				? "One described problem, as a reverse search"
				: "A described problem (write it first)"
			: props.companies
				? `${count(props.companies, "company", "companies")}, ${count(props.challenges, "challenge")}`
				: "No company chosen yet"
	const startLabel = props.starting ? "Starting…" : mode === "problem" ? "Find researchers" : "Start the run"
	return (
		<aside className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-card shadow-card lg:min-h-0">
			<header className="flex h-11 shrink-0 items-center border-b border-hairline px-4">
				<h2 className="text-base font-medium text-ink">Run</h2>
			</header>
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
				<dl className="flex flex-col gap-3 text-sm">
					<Fact label="Data">{dataset ? dataset.name : "—"}</Fact>
					<Fact label="Searches">{dataset ? `${count(dataset.counts.researchers, "researcher")} and their records` : "—"}</Fact>
					<Fact label="Works on">{work}</Fact>
				</dl>

				<div className="flex flex-col gap-2">
					<span className="text-sm font-medium text-ink">Model</span>
					<Segmented<"mock" | "real">
						aria-label="Model"
						className="w-full [&>button]:flex-1"
						value={useMock ? "mock" : "real"}
						onValueChange={(value) => props.setMock(value === "mock")}
						items={[
							{ value: "mock", label: "Mock" },
							{ value: "real", label: "Real models", title: props.canRunReal ? undefined : "The server has no API key" },
						]}
					/>
					<p className="text-sm text-ink-muted">
						{!props.canRunReal
							? "The server has no API key, so only the mock can run. Set one in .env, or LOCAL_CLAUDE=1, and restart."
							: useMock
								? "Canned answers in about a minute, no cost. The agents, the Critic and the trace are real."
								: "Real models: several minutes per company, and it spends API credit. The agents send the records they read to the model provider."}
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<NumberField
						id="new-k"
						label="Researchers per challenge"
						value={props.k}
						onChange={props.setK}
						placeholder={mode === "problem" ? "6" : "4"}
						invalid={props.kInvalid}
					/>
					<NumberField
						id="new-proposals"
						label="Most proposals"
						value={props.proposals}
						onChange={props.setProposals}
						placeholder={mode === "problem" ? "1" : "1 each"}
						invalid={props.proposalsInvalid}
					/>
				</div>

				<p className="text-sm text-ink-subtle">
					Pairs, not people: each fit is for this problem only. Nobody is contacted until a coordinator approves the pair. Uploaded files stay on this
					machine.
				</p>
			</div>
			<footer className="shrink-0 border-t border-hairline p-4">
				<Button variant="primary" size="lg" className="w-full" disabled={!props.ready || props.starting} onClick={props.onStart}>
					{startLabel}
				</Button>
			</footer>
		</aside>
	)
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
			<dt className="text-ink-subtle">{label}</dt>
			<dd className="min-w-0 text-ink">{children}</dd>
		</div>
	)
}

function NumberField({
	id,
	label,
	value,
	onChange,
	placeholder,
	invalid,
}: {
	id: string
	label: string
	value: string
	onChange(value: string): void
	placeholder: string
	invalid: boolean
}) {
	return (
		<div className="flex min-w-0 items-center justify-between gap-3">
			<label htmlFor={id} className="min-w-0 text-sm text-ink-muted">
				{label}
			</label>
			<Input
				id={id}
				inputMode="numeric"
				value={value}
				onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ""))}
				placeholder={placeholder}
				aria-invalid={invalid}
				className={cn("h-8 w-28 shrink-0 text-right text-sm", invalid && "border-failed")}
			/>
		</div>
	)
}

// ---------------------------------------------------------------------------

/** A hosted build has no server to run agents: say how to get one, in three commands. */
function HostedNotice() {
	return (
		<EmptyState
			icon={<Terminal />}
			title="Runs start on your own machine"
			className="h-full"
			action={
				<Button asChild>
					<Link to="/">See the committed runs</Link>
				</Button>
			}
		>
			<p>
				This page is a hosted replay. To find researchers for your own problem, or to run the agents on your own data, start the app locally. Without
				an API key it runs on the mock model.
			</p>
			<pre className="mt-4 overflow-x-auto rounded-md bg-sunken px-4 py-3 text-left text-sm text-ink">
				{"git clone https://github.com/madebynikola/Entangle.git\ncd Entangle && npm install\nnpm run dev"}
			</pre>
		</EmptyState>
	)
}
