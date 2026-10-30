import { Children, isValidElement } from "react"
import type * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { SourceChip } from "@/components/shell/source"
import { cn } from "@/lib/utils"

/** `[C014-CH1]` or `[SYN-PUB-02211, SYN-PUB-02240]`: dataset ids cited inline. */
const CITATION = /\[((?:R\d{3,4}|C\d{3}(?:-CH\d+)?|SYN-[A-Z]{3}-\d+|C\d{3}\/[^\]]+?)(?:\s*,\s*(?:R\d{3,4}|C\d{3}(?:-CH\d+)?|SYN-[A-Z]{3}-\d+|C\d{3}\/[^\],]+?))*)\]/g

/** Replace inline citations in plain-text children with source chips. */
function cite(children: React.ReactNode): React.ReactNode {
	return Children.map(children, (child) => {
		if (typeof child !== "string") return isValidElement(child) ? child : child
		const parts: React.ReactNode[] = []
		let last = 0
		for (const match of child.matchAll(CITATION)) {
			parts.push(child.slice(last, match.index))
			const ids = match[1].split(/\s*,\s*/)
			parts.push(
				<span key={match.index} className="mx-0.5 inline-flex flex-wrap gap-1 align-[1px]">
					{ids.map((id) => (
						<SourceChip key={id} id={id} className="h-5" />
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
	h1: ({ children }) => <h1 className="mb-3 mt-6 text-2xl font-medium text-ink first:mt-0">{children}</h1>,
	h2: ({ children }) => <h2 className="mb-2.5 mt-6 text-xl font-medium text-ink first:mt-0">{children}</h2>,
	h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-medium text-ink first:mt-0">{children}</h3>,
	p: ({ children }) => <p className="my-2.5 leading-relaxed">{cite(children)}</p>,
	li: ({ children }) => <li className="my-1 leading-relaxed">{cite(children)}</li>,
	ul: ({ children }) => <ul className="my-2.5 list-disc pl-5 marker:text-ink-subtle">{children}</ul>,
	ol: ({ children }) => <ol className="my-2.5 list-decimal pl-5 marker:text-ink-muted">{children}</ol>,
	strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
	a: ({ children, href }) => (
		<a href={href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
			{children}
		</a>
	),
	code: ({ children }) => <code className="rounded-xs bg-sunken px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
	blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-strong pl-4 text-ink-muted">{children}</blockquote>,
	hr: () => <hr className="my-6 border-hairline" />,
	table: ({ children }) => (
		<div className="my-4 overflow-x-auto rounded-md border border-hairline">
			<table className="w-full border-collapse text-sm">{children}</table>
		</div>
	),
	th: ({ children }) => <th className="border-b border-hairline bg-sunken px-3 py-2 text-left font-medium text-ink">{children}</th>,
	td: ({ children }) => <td className="border-b border-hairline px-3 py-2 align-top last:border-b-0">{cite(children)}</td>,
}

/** Proposal markdown in the app's type, with cited ids as hoverable source chips. */
export function Markdown({ children, className }: { children: string; className?: string }) {
	return (
		<div className={cn("max-w-[72ch] text-base text-ink", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{children}
			</ReactMarkdown>
		</div>
	)
}
