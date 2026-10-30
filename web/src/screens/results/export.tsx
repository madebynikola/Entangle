import type { Approval } from "@shared/server/api"
import type { Proposal, SourceRecord } from "@shared/types"
import { Download, FileText, Printer } from "lucide-react"
import { Children, useState } from "react"
import type * as React from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/components/ui/toaster"
import * as format from "@/lib/format"
import { getBackend } from "@/run/backend"
import { byDatasetId, kindLabel, stripTitle } from "./data"

/** What an exported proposal says about itself: who it pairs, how review went, and the person's decision. */
export interface ExportContext {
	proposal: Proposal
	runId: string
	company: string
	researcher: string
	review: string
	approval?: Approval
}

const SOURCE_ID = /^(R\d{3,4}|C\d{3}(?:-CH\d+)?|SYN-[A-Z]{3}-\d+|C\d{3}\/.+)$/
const CITATION = /\[([^\]\n]+)\](?!\()/g

/** Every dataset id the proposal cites: in its claims and inline as `[ID]` or `[ID, ID]`. */
export function citedIds(proposal: Proposal): string[] {
	const ids = new Set<string>()
	for (const claim of proposal.claims) for (const id of claim.sourceIds) ids.add(id)
	for (const match of proposal.markdown.matchAll(CITATION)) {
		for (const part of match[1].split(/\s*,\s*/)) if (SOURCE_ID.test(part.trim())) ids.add(part.trim())
	}
	return [...ids].sort(byDatasetId)
}

async function loadSources(ids: string[], runId: string): Promise<Map<string, SourceRecord | null>> {
	const backend = await getBackend()
	const records = await Promise.all(ids.map((id) => backend.getSource(id, runId).catch(() => null)))
	return new Map(ids.map((id, i) => [id, records[i]]))
}

function decisionLine(approval?: Approval): string {
	if (!approval) return "Not approved yet. A person must approve this pair before anyone is contacted."
	const when = format.dateTime(approval.decidedAt)
	return approval.decision === "approved" ? `Approved for outreach by a person on ${when}.` : `Rejected by a person on ${when}. Do not send.`
}

function sourceLine(record: SourceRecord | null | undefined): string {
	if (!record) return "not found in the run's sources or the dataset"
	const details = [record.kind, record.year].filter(Boolean).join(", ")
	return `${record.title}${details ? ` (${details})` : ""}`
}

function toMarkdown(ctx: ExportContext, sources: Map<string, SourceRecord | null>): string {
	const { proposal } = ctx
	const list = [...sources].map(([id, record]) => `- **${id}**: ${sourceLine(record)}`).join("\n")
	return `${proposal.markdown.trimEnd()}

---

## Sources

Each id in square brackets cites one record in the EINSTEIN dataset.

${list}

---

_Pair ${proposal.pairId}. ${ctx.review}. ${decisionLine(ctx.approval)}_
_Written by the EINSTEIN matchmaker, run ${ctx.runId}._
`
}

function download(name: string, text: string, type: string): void {
	const url = URL.createObjectURL(new Blob([text], { type }))
	const link = Object.assign(document.createElement("a"), { href: url, download: name })
	document.body.append(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// PDF: a print-ready copy of the proposal in a hidden frame, then the browser's print dialog ("Save as PDF").
// ---------------------------------------------------------------------------

const PRINT_CSS = `
@page { size: A4; margin: 18mm 18mm 20mm; }
html, body { background: #fff !important; color: #171717 !important; }
body { margin: 0; font: 10.5pt/1.55 "Geist Variable", -apple-system, system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc { max-width: 174mm; margin: 0 auto; }
.doc h1 { font-size: 19pt; line-height: 1.2; font-weight: 600; letter-spacing: -0.015em; margin: 0 0 6pt; }
.doc h2 { font-size: 13pt; line-height: 1.3; font-weight: 600; margin: 18pt 0 6pt; break-after: avoid; }
.doc h3 { font-size: 11pt; line-height: 1.3; font-weight: 600; margin: 14pt 0 4pt; break-after: avoid; }
.doc p, .doc li { margin: 0 0 6pt; orphans: 3; widows: 3; }
.doc ul { list-style: disc; padding-left: 15pt; margin: 0 0 8pt; }
.doc ol { list-style: decimal; padding-left: 15pt; margin: 0 0 8pt; }
.doc strong { font-weight: 600; }
.doc table { border-collapse: collapse; width: 100%; margin: 8pt 0 10pt; font-size: 9.5pt; }
.doc th, .doc td { border: 0.5pt solid #d4d4d4; padding: 4pt 6pt; text-align: left; vertical-align: top; }
.doc th { background: #f4f4f5; font-weight: 600; }
.doc tr { break-inside: avoid; }
.doc code, .doc .cite, .doc .id { font-family: "Geist Mono Variable", ui-monospace, monospace; }
.doc .cite { font-size: 7.5pt; color: #666; overflow-wrap: anywhere; }
.doc hr { border: 0; border-top: 0.5pt solid #d4d4d4; margin: 14pt 0; }
.doc blockquote { border-left: 2pt solid #d4d4d4; padding-left: 8pt; color: #555; margin: 0 0 8pt; }
.doc-head { border-bottom: 0.75pt solid #171717; padding-bottom: 10pt; margin-bottom: 16pt; }
.doc-meta { color: #666; font-size: 9.5pt; margin: 0 !important; }
.doc-status { font-size: 9.5pt; font-weight: 600; margin: 6pt 0 0 !important; }
.doc-sources { margin-top: 22pt; }
.doc-sources table { font-size: 8.5pt; }
.doc-sources .id { white-space: nowrap; width: 1%; }
.doc-sources .kind { color: #666; }
.doc-foot { margin-top: 14pt; color: #8f8f8f; font-size: 8.5pt; }
`

/** `[C003-CH1]` in running text, set small and grey so the prose reads first. */
function cite(children: React.ReactNode): React.ReactNode {
	return Children.map(children, (child) => {
		if (typeof child !== "string") return child
		const parts: React.ReactNode[] = []
		let last = 0
		for (const match of child.matchAll(CITATION)) {
			if (!match[1].split(/\s*,\s*/).every((part) => SOURCE_ID.test(part.trim()))) continue
			parts.push(child.slice(last, match.index))
			parts.push(
				<span key={match.index} className="cite">
					{match[0]}
				</span>,
			)
			last = match.index + match[0].length
		}
		parts.push(child.slice(last))
		return parts
	})
}

const printComponents: Components = {
	p: ({ children }) => <p>{cite(children)}</p>,
	li: ({ children }) => <li>{cite(children)}</li>,
	td: ({ children }) => <td>{cite(children)}</td>,
}

function PrintDocument({ ctx, sources }: { ctx: ExportContext; sources: Map<string, SourceRecord | null> }) {
	const { proposal } = ctx
	return (
		<main className="doc">
			<header className="doc-head">
				<h1>{proposal.title}</h1>
				<p className="doc-meta">
					{kindLabel(proposal.kind)} for {ctx.company} and {ctx.researcher}. {ctx.review}.
				</p>
				<p className="doc-status">{decisionLine(ctx.approval)}</p>
			</header>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={printComponents}>
				{stripTitle(proposal.markdown, proposal.title)}
			</ReactMarkdown>
			<section className="doc-sources">
				<h2>Sources</h2>
				<p>Each id in square brackets cites one record in the EINSTEIN dataset.</p>
				<table>
					<tbody>
						{[...sources].map(([id, record]) => (
							<tr key={id}>
								<td className="id">{id}</td>
								<td>
									{record ? record.title : "Not found in the run's sources or the dataset"}
									{record && <span className="kind"> ({[record.kind, record.year].filter(Boolean).join(", ")})</span>}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>
			<p className="doc-foot">
				Pair {proposal.pairId}. Written by the EINSTEIN matchmaker, run {ctx.runId}. Printed {format.dateTime(Date.now())}.
			</p>
		</main>
	)
}

async function print(ctx: ExportContext, sources: Map<string, SourceRecord | null>): Promise<void> {
	const frame = document.createElement("iframe")
	frame.setAttribute("aria-hidden", "true")
	frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0;"
	document.body.append(frame)
	const doc = frame.contentDocument!
	doc.open()
	doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title></title></head><body></body></html>`)
	doc.close()
	doc.title = `${ctx.proposal.id} ${ctx.proposal.title}`

	// The app's stylesheets bring the Geist faces; the print rules come last and win.
	const loads: Promise<unknown>[] = []
	for (const node of document.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')) {
		const copy = node.cloneNode(true) as HTMLElement
		if (copy instanceof HTMLLinkElement) {
			loads.push(
				new Promise((resolve) => {
					copy.onload = resolve
					copy.onerror = resolve
				}),
			)
		}
		doc.head.append(copy)
	}
	const style = doc.createElement("style")
	style.textContent = PRINT_CSS
	doc.head.append(style)

	const root = createRoot(doc.body.appendChild(doc.createElement("div")))
	flushSync(() => root.render(<PrintDocument ctx={ctx} sources={sources} />))
	await Promise.race([Promise.all(loads).then(() => doc.fonts?.ready), new Promise((resolve) => setTimeout(resolve, 2500))])

	const done = () => {
		root.unmount()
		frame.remove()
	}
	frame.contentWindow!.addEventListener("afterprint", () => setTimeout(done, 0), { once: true })
	setTimeout(() => frame.isConnected && done(), 120_000)
	frame.contentWindow!.focus()
	frame.contentWindow!.print()
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

/** Export a proposal as Markdown (with a source list) or as a PDF through the print dialog. */
export function ExportMenu({ ctx }: { ctx: ExportContext }) {
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState(false)

	const run = async (as: "markdown" | "pdf") => {
		setBusy(true)
		try {
			const sources = await loadSources(citedIds(ctx.proposal), ctx.runId)
			setOpen(false)
			if (as === "markdown") {
				const name = `${ctx.proposal.id}.md`
				download(name, toMarkdown(ctx, sources), "text/markdown;charset=utf-8")
				toast.success("Downloaded", { description: name })
			} else {
				await print(ctx, sources)
			}
		} catch (error) {
			toast.error("The export did not finish", { description: error instanceof Error ? error.message : String(error) })
		} finally {
			setBusy(false)
		}
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button size="sm" disabled={busy}>
					<Download />
					Export
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-72 flex-col p-1">
				<MenuItem icon={<FileText />} title="Markdown" hint="A .md file, with a list of every cited source" onClick={() => run("markdown")} />
				<MenuItem icon={<Printer />} title="PDF" hint="Opens the print dialog. Choose Save as PDF." onClick={() => run("pdf")} />
			</PopoverContent>
		</Popover>
	)
}

function MenuItem({ icon, title, hint, onClick }: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:bg-hover [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted"
		>
			{icon}
			<span>
				<span className="block text-sm font-medium text-ink">{title}</span>
				<span className="block text-xs text-ink-muted">{hint}</span>
			</span>
		</button>
	)
}
