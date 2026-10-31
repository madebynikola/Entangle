import { Children, Fragment, isValidElement } from "react"
import type * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { SourceChip } from "@/components/shell/source"
import { cn } from "@/lib/utils"

/** One dataset id, or an OpenAlex work (`W4293154696`). A page id ends in its title, which can hold commas: `C002/news/2024-04-22/<title>`. */
const ID = String.raw`(?:R\d{3,4}|C\d{3}(?:-CH\d+)?|SYN-[A-Z]{3}-\d+|W\d{6,}|C\d{3}\/[^\]]+?)`
/** `[C014-CH1]` or `[SYN-PUB-02211, SYN-PUB-02240]`: dataset ids cited inline. */
const CITATION = new RegExp(String.raw`\[(${ID}(?:\s*,\s*${ID})*)\]`, "g")
/** The comma between two ids, not one inside a page title. */
const BETWEEN = /\s*,\s*(?=R\d{3,4}\b|C\d{3}\b|SYN-|W\d{6,}\b)/

/**
 * Replace inline citations in plain-text children with source chips that wrap with the text, one by one.
 * A source already cited earlier in the same paragraph is drawn quieter, so a paragraph that cites one record
 * five times does not read as five badges; every citation stays and still opens its record.
 */
function cite(children: React.ReactNode): React.ReactNode {
	const seen = new Set<string>()
	return Children.map(children, (child) => {
		if (typeof child !== "string") return isValidElement(child) ? child : child
		const parts: React.ReactNode[] = []
		let last = 0
		for (const match of child.matchAll(CITATION)) {
			parts.push(child.slice(last, match.index))
			const ids = match[1].split(BETWEEN)
			const repeat = ids.map((id) => seen.has(id))
			for (const id of ids) seen.add(id)
			parts.push(
				<span key={match.index} className="mx-0.5">
					{ids.map((id, i) => (
						<Fragment key={id}>
							{i > 0 && " "}
							<SourceChip id={id} className={cn("h-5 align-[1px]", repeat[i] && "opacity-45 hover:opacity-100")} />
						</Fragment>
					))}
				</span>,
			)
			last = match.index + match[0].length
		}
		parts.push(child.slice(last))
		return parts
	})
}

const components: Components = {
	h1: ({ children }) => <h1 className="mb-3 mt-6 font-sans text-2xl font-semibold tracking-tight text-ink first:mt-0">{children}</h1>,
	h2: ({ children }) => <h2 className="mb-2.5 mt-6 font-sans text-xl font-semibold tracking-tight text-ink first:mt-0">{children}</h2>,
	h3: ({ children }) => <h3 className="mb-2 mt-5 font-sans text-lg font-semibold text-ink first:mt-0">{children}</h3>,
	p: ({ children }) => <p className="my-2.5 leading-relaxed">{cite(children)}</p>,
	li: ({ children }) => <li className="my-1 leading-relaxed">{cite(children)}</li>,
	ul: ({ children }) => <ul className="my-2.5 list-disc pl-5 marker:text-ink-subtle">{children}</ul>,
	ol: ({ children }) => <ol className="my-2.5 list-decimal pl-5 marker:text-ink-muted">{children}</ol>,
	strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
	a: ({ children, href }) => (
		<a href={href} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
			{children}
		</a>
	),
	code: ({ children }) => <code className="rounded-xs bg-sunken px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
	blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-strong pl-4 text-ink-muted">{children}</blockquote>,
	hr: () => <hr className="my-6 border-hairline" />,
	table: ({ children }) => (
		<div className="my-4 overflow-x-auto rounded-md border border-hairline font-sans">
			<table className="w-full border-collapse text-sm">{children}</table>
		</div>
	),
	th: ({ children }) => <th className="border-b border-hairline bg-sunken px-3 py-2 text-left font-medium text-ink">{children}</th>,
	td: ({ children }) => <td className="border-b border-hairline px-3 py-2 align-top last:border-b-0">{cite(children)}</td>,
}

/** Proposal markdown: body in Source Serif 4, so it reads like an academic document; headings and tables in Inter; cited ids as hoverable source chips. */
export function Markdown({ children, className }: { children: string; className?: string }) {
	return (
		<div className={cn("max-w-[68ch] font-serif text-[16.5px] leading-[1.62] text-ink", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{children}
			</ReactMarkdown>
		</div>
	)
}
