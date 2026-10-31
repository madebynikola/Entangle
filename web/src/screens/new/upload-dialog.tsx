import type { DatasetInfo } from "@shared/server/api"
import { Download, FileUp, X } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useBackend } from "@/run/hooks"

/** What a file holds, by its name, as the server reads it (src/data/import.ts). */
const KINDS: [RegExp, string][] = [
	[/page/, "Company pages"],
	[/researcher|people|staff/, "Researchers"],
	[/publication|paper|works/, "Publications"],
	[/project/, "Projects"],
	[/patent/, "Patents"],
	[/compan|challenge/, "Companies"],
]

function kindOf(name: string): string | null {
	const base = name.toLowerCase()
	return KINDS.find(([pattern]) => pattern.test(base))?.[1] ?? null
}

const ACCEPT = ".json,.jsonl,.ndjson,.csv"

/** The fields each list needs. The rest is optional and filled with empty values. */
const FORMAT: [string, string, string][] = [
	["researchers.json or .csv", "name", "title, faculty, department, fields, keywords, bio, publications, projects, open_to, notes"],
	["publications.jsonl", "title", "abstract, year, venue, keywords, authors: [{ name, researcher_id }]"],
	["projects.json", "title", "summary, years, programme, participants: [{ researcher_id, role }]"],
	["patents.json", "title", "abstract, year, inventors: [{ researcher_id }]"],
	["companies.json or .csv", "name, challenges", "sector, about, products, tech; a challenge is text or { text, detail }"],
	["company-pages.jsonl", "company_id, text", "kind, title, date"],
]

/** A one-file example of every list, in the shape the importer reads. Invented people, as in the dataset. */
const TEMPLATE = {
	researchers: [
		{
			id: "R0001",
			name: "Ana Example",
			title: "Associate Professor",
			institution: "Your University",
			faculty: "Faculty of Engineering",
			department: "Department of Control Systems",
			fields: ["Control Engineering", "Robotics"],
			keywords: ["model predictive control", "drones", "wind disturbance rejection"],
			bio: "Ana works on the control of small aerial vehicles in wind, and on optimisation that runs on embedded hardware.",
			publications: ["SYN-PUB-00001"],
			projects: [],
			patents: [],
			open_to: ["joint projects with companies", "industrial PhD supervision"],
			industry_experience: "Two years as a flight-control engineer at a drone maker.",
			notes: "",
			language: "en",
		},
	],
	publications: [
		{
			id: "SYN-PUB-00001",
			title: "Gust-tolerant model predictive control for quadrotors",
			abstract: "We design a model predictive controller that rejects wind gusts on small drones and test it outdoors.",
			year: 2024,
			venue: "Conference on Decision and Control",
			type: "conference",
			keywords: ["MPC", "quadrotor", "wind"],
			authors: [{ name: "Ana Example", researcher_id: "R0001", affiliation: "Your University" }],
		},
	],
	companies: [
		{
			id: "C001",
			name: "Example Drones d.o.o.",
			sector: "Drones",
			about: "We build inspection drones for power lines.",
			challenges: [
				{
					id: "C001-CH1",
					text: "Our inspection drones drift in wind gusts near power lines.",
					detail: "Seasonal PID tuning did not fix it. We have 300 hours of flight logs.",
				},
			],
		},
	],
}

function downloadTemplate() {
	const blob = new Blob([JSON.stringify(TEMPLATE, null, 2) + "\n"], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	const link = document.createElement("a")
	link.href = url
	link.download = "entangle-data-template.json"
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Add your own data: files in the EINSTEIN dataset's format, read by the local server and kept in data/uploads/.
 * Resolves with the new dataset, which the New run screen then selects.
 */
export function UploadDialog({ open, onOpenChange, onUploaded }: { open: boolean; onOpenChange(open: boolean): void; onUploaded(dataset: DatasetInfo): void }) {
	const backend = useBackend()
	const input = useRef<HTMLInputElement>(null)
	const [name, setName] = useState("")
	const [files, setFiles] = useState<File[]>([])
	const [dragging, setDragging] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const add = (list: FileList | null) => {
		if (!list?.length) return
		// Copy now: the input's FileList empties when its value is reset, before React runs the updater.
		const added = Array.from(list)
		setError(null)
		setFiles((current) => {
			const byName = new Map(current.map((file) => [file.name, file]))
			for (const file of added) byName.set(file.name, file)
			return [...byName.values()]
		})
	}
	const hasResearchers = files.some((file) => kindOf(file.name) === "Researchers" || !kindOf(file.name))

	const reset = () => {
		setName("")
		setFiles([])
		setError(null)
	}

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!backend || !files.length || uploading) return
		setUploading(true)
		setError(null)
		try {
			const dataset = await backend.uploadDataset(name.trim() || "My data", files)
			reset()
			onOpenChange(false)
			onUploaded(dataset)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		} finally {
			setUploading(false)
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!uploading) onOpenChange(next)
			}}
		>
			<DialogContent className="max-w-2xl">
				<DialogTitle>Add your own data</DialogTitle>
				<DialogDescription>
					Your researchers and companies, in the EINSTEIN dataset's format. Only researchers are required. The files stay on this machine, in{" "}
					<code className="rounded-xs bg-sunken px-1 text-xs">data/uploads/</code>.
				</DialogDescription>

				<form onSubmit={submit} className="mt-5 flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<label htmlFor="upload-name" className="text-sm font-medium text-ink">
							Name
						</label>
						<Input id="upload-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="My lab" />
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-sm font-medium text-ink">Files</span>
						<label
							onDragOver={(event) => {
								event.preventDefault()
								setDragging(true)
							}}
							onDragLeave={() => setDragging(false)}
							onDrop={(event) => {
								event.preventDefault()
								setDragging(false)
								add(event.dataTransfer.files)
							}}
							className={cn(
								"flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
								dragging ? "border-link bg-link/5" : "border-strong bg-sunken/60 hover:border-ink-subtle",
							)}
						>
							<FileUp className="size-5 text-ink-muted" />
							<span className="text-sm text-ink">
								Drop files here, or <span className="font-medium text-link">choose files</span>
							</span>
							<span className="text-xs text-ink-subtle">.json, .jsonl or .csv · up to 100 MB in all</span>
							<input
								ref={input}
								type="file"
								multiple
								accept={ACCEPT}
								aria-label="Choose files"
								className="sr-only"
								onChange={(event) => {
									add(event.target.files)
									event.target.value = ""
								}}
							/>
						</label>
						{files.length > 0 && (
							<ul className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
								{files.map((file) => {
									const kind = kindOf(file.name)
									return (
										<li key={file.name} className="flex items-center gap-3 py-1.5 pl-3 pr-1.5 text-sm">
											<span className="min-w-0 flex-1 truncate text-ink">{file.name}</span>
											<span className="tabular shrink-0 text-xs text-ink-subtle">{size(file.size)}</span>
											<Chip tone={kind ? "default" : "needs"}>{kind ?? "Read by its fields"}</Chip>
											<Button
												variant="quiet"
												size="icon-sm"
												className="size-7"
												aria-label={`Remove ${file.name}`}
												onClick={() => setFiles((current) => current.filter((other) => other !== file))}
											>
												<X />
											</Button>
										</li>
									)
								})}
							</ul>
						)}
						{files.length > 0 && !hasResearchers && (
							<p className="text-sm text-needs">Add researchers.json or researchers.csv: the agents search researchers.</p>
						)}
					</div>

					<details className="group rounded-md bg-sunken px-3 py-2.5 text-sm">
						<summary className="cursor-pointer select-none text-ink-muted marker:text-ink-subtle hover:text-ink">What each file needs</summary>
						<table className="mt-2 w-full text-left text-xs">
							<thead className="text-ink-subtle">
								<tr>
									<th className="py-1 pr-3 font-normal">File</th>
									<th className="py-1 pr-3 font-normal">Needs</th>
									<th className="py-1 font-normal">May have</th>
								</tr>
							</thead>
							<tbody className="align-top text-ink-muted">
								{FORMAT.map(([file, needs, may]) => (
									<tr key={file} className="border-t border-hairline">
										<td className="whitespace-nowrap py-1 pr-3 text-ink">{file}</td>
										<td className="whitespace-nowrap py-1 pr-3">{needs}</td>
										<td className="py-1">{may}</td>
									</tr>
								))}
							</tbody>
						</table>
						<p className="mt-2 text-xs text-ink-muted">
							One JSON file may hold several lists, as the template does. A link given on one side only (a researcher's publications, or a
							publication's authors) is made on both. Ids that do not look like the dataset's (R0001, C001, C001-CH1, SYN-PUB-00001) get new ones,
							so the Critic can check every citation; the upload keeps a list of what changed.
						</p>
					</details>

					{error && <p className="whitespace-pre-line rounded-md bg-failed/8 px-3 py-2 text-sm text-failed">{error}</p>}

					<div className="flex items-center justify-between gap-2">
						<Button variant="quiet" size="sm" onClick={downloadTemplate}>
							<Download />
							Download a template
						</Button>
						<div className="flex gap-2">
							<Button variant="quiet" onClick={() => onOpenChange(false)} disabled={uploading}>
								Cancel
							</Button>
							<Button type="submit" variant="primary" disabled={!files.length || uploading}>
								{uploading ? "Reading…" : "Add data"}
							</Button>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
