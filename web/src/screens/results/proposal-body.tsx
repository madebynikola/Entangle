import { AgentFace } from "@/components/ui/face"
import { Markdown } from "@/components/ui/markdown"
import { cn } from "@/lib/utils"

/**
 * A proposal's text, laid out by section. The words are the Writer's, unchanged: the research questions become
 * numbered cards, the plan a timeline, what each side brings two columns, and the agreed terms labelled rows.
 * A section that does not have the expected shape is shown as plain Markdown, so nothing is ever hidden.
 * The intro lines (company, researcher, format) are left out here: the header above already says them.
 */
export function ProposalBody({ markdown, className }: { markdown: string; className?: string }) {
	const sections = sectionsOf(markdown)
	if (sections.length === 0) return <Markdown className={className}>{markdown}</Markdown>
	return (
		<div className={cn("flex gap-10", className)}>
			<div className="min-w-0 max-w-[68ch] flex-1">
				{sections.map((section) => (
					<section key={section.id} id={section.id} className="scroll-mt-4">
						<h3 className="mb-2 mt-8 font-sans text-lg font-semibold text-ink first:mt-0">{section.title}</h3>
						<SectionBody section={section} />
					</section>
				))}
			</div>
			<Contents sections={sections} />
		</div>
	)
}

interface Section {
	id: string
	title: string
	body: string
}

/** The `### ` sections of a proposal, after its intro. */
function sectionsOf(markdown: string): Section[] {
	const parts = markdown.split(/^### (.+)$/m)
	const sections: Section[] = []
	for (let i = 1; i < parts.length; i += 2) {
		const title = parts[i].trim()
		sections.push({ id: `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title, body: parts[i + 1]?.trim() ?? "" })
	}
	return sections
}

function SectionBody({ section }: { section: Section }) {
	const title = section.title.toLowerCase()
	const shaped =
		title === "research questions"
			? questions(section.body)
			: title === "plan"
				? plan(section.body)
				: title === "what each side brings"
					? sides(section.body)
					: title.startsWith("agreed up front")
						? terms(section.body)
						: null
	return shaped ?? <Markdown>{section.body}</Markdown>
}

/** Text with its citations as source chips, in the proposal's serif, without a paragraph's margins. */
function Text({ children, className }: { children: string; className?: string }) {
	return <Markdown className={cn("max-w-none text-[15.5px] leading-[1.6] [&_p]:my-0", className)}>{children}</Markdown>
}

/** Lines of a section that are all list items of one pattern, or null when any line is something else. */
function items(body: string, pattern: RegExp): RegExpMatchArray[] | null {
	const lines = body.split("\n").filter((line) => line.trim())
	const matches = lines.map((line) => line.match(pattern))
	return matches.length && matches.every(Boolean) ? (matches as RegExpMatchArray[]) : null
}

/** "1. Can … ? Measured as …": a numbered card, the measure set apart because it is what makes the question checkable. */
function questions(body: string) {
	const list = items(body, /^\d+\.\s+(.+)$/)
	if (!list) return null
	return (
		<ol className="my-3 flex flex-col gap-2.5">
			{list.map(([, text], i) => {
				const at = text.search(/\bMeasured (?:as|by|with)\b/)
				const question = at > 0 ? text.slice(0, at).trim() : text
				const measure = at > 0 ? text.slice(at).trim() : ""
				return (
					<li key={i} className="flex gap-3 rounded-lg border border-hairline bg-panel p-4">
						<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft font-sans text-xs font-semibold text-ink">
							{i + 1}
						</span>
						<div className="min-w-0 flex-1">
							<Text>{question}</Text>
							{measure && <Text className="mt-2 font-sans text-sm text-ink-muted">{measure}</Text>}
						</div>
					</li>
				)
			})}
		</ol>
	)
}

/** The plan table (`| Period | Work | Result |`) as a timeline, one step per period. */
function plan(body: string) {
	const rows = body
		.split("\n")
		.filter((line) => line.trim().startsWith("|"))
		.map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
	const [head, rule, ...steps] = rows
	if (!head || head.join("|").toLowerCase() !== "period|work|result" || !rule?.every((cell) => /^:?-+:?$/.test(cell))) return null
	if (!steps.length || steps.some((cells) => cells.length !== 3)) return null
	return (
		<ol className="my-3">
			{steps.map(([period, work, result], i) => (
				<li key={i} className="relative flex gap-4 pb-5 last:pb-0">
					{i < steps.length - 1 && <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-hairline" />}
					<span aria-hidden className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-panel" />
					<div className="min-w-0 flex-1">
						<div className="font-sans text-sm font-semibold text-ink">{period}</div>
						<Text className="mt-1">{work}</Text>
						{result && (
							<Text className="mt-1.5 font-sans text-sm text-ink-muted">{`**Result:** ${result}`}</Text>
						)}
					</div>
				</li>
			))}
		</ol>
	)
}

/** "- **Company:** …" and "- **Faculty:** …" as two cards, each with the face of the agent that read that side. Stacked: each side is several cited sentences. */
function sides(body: string) {
	const list = items(body, /^-\s+\*\*(Company|Faculty):\*\*\s*(.+)$/)
	if (!list || list.length !== 2 || list[0][1] === list[1][1]) return null
	const byLabel = Object.fromEntries(list.map(([, label, text]) => [label, text]))
	return (
		<div className="my-3 flex flex-col gap-3">
			{(["Company", "Faculty"] as const).map((label) => (
				<div key={label} className="rounded-lg border border-hairline bg-panel p-4">
					<div className="mb-2 flex items-center gap-2 font-sans text-sm font-semibold text-ink">
						<AgentFace face={label === "Company" ? "spica" : "tycho"} className="size-5" />
						{label === "Company" ? "The company" : "The faculty"}
					</div>
					<Text>{byLabel[label]}</Text>
				</div>
			))}
		</div>
	)
}

/** "- Publication: …" rows as labelled terms. The text after the label starts a sentence of its own here, so its first letter is capitalised. */
function terms(body: string) {
	const list = items(body, /^-\s+([A-Z][A-Za-z ]{1,30}):\s+(.+)$/)
	if (!list) return null
	return (
		<dl className="my-3 divide-y divide-hairline rounded-lg border border-hairline bg-panel">
			{list.map(([, label, text], i) => (
				<div key={i} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
					<dt className="font-sans text-sm font-semibold text-ink">{label}</dt>
					<dd className="min-w-0">
						<Text>{text.charAt(0).toUpperCase() + text.slice(1)}</Text>
					</dd>
				</div>
			))}
		</dl>
	)
}

/** The section list beside the text, on wide screens; it stays in view while the proposal scrolls. */
function Contents({ sections }: { sections: Section[] }) {
	return (
		<nav aria-label="Sections" className="sticky top-0 hidden w-44 shrink-0 self-start xl:block">
			<div className="mb-2 font-sans text-xs font-medium text-ink-subtle">On this page</div>
			<ul className="flex flex-col gap-0.5 border-l border-hairline">
				{sections.map((section) => (
					<li key={section.id}>
						<button
							type="button"
							onClick={() => document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
							className="-ml-px block w-full border-l border-transparent py-1 pl-3 text-left font-sans text-sm text-ink-muted transition-colors hover:border-strong hover:text-ink"
						>
							{section.title}
						</button>
					</li>
				))}
			</ul>
		</nav>
	)
}
