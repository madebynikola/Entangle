import type { Claim } from "@shared/types"
import type * as React from "react"
import { useSearchParams } from "react-router"
import { ClaimText, useSource } from "@/components/shell/source"
import * as format from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ResultsIndex } from "./data"

/** The right side of the split: a fixed header (title, actions, tabs) over a body that scrolls. */
export function DetailFrame({
	header,
	actions,
	tabs,
	bodyKey,
	children,
}: {
	header: React.ReactNode
	actions?: React.ReactNode
	tabs?: React.ReactNode
	/** Changing it starts the body at the top again. */
	bodyKey?: string
	children: React.ReactNode
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
			<header className={cn("px-6 pt-5", tabs ? "border-b border-hairline" : "border-b border-hairline pb-5")}>
				<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
					<div className="min-w-0 flex-1 basis-80">{header}</div>
					{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
				</div>
				{tabs && <div className="mt-2">{tabs}</div>}
			</header>
			<div key={bodyKey} className="scrollbar-thin px-6 py-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
				{children}
			</div>
		</div>
	)
}

/** A titled block inside a detail body. */
export function Block({
	title,
	description,
	className,
	children,
}: {
	title: React.ReactNode
	description?: React.ReactNode
	className?: string
	children: React.ReactNode
}) {
	return (
		<section className={cn("flex max-w-[80ch] flex-col gap-2.5", className)}>
			<div>
				<h3 className="text-sm font-semibold text-ink">{title}</h3>
				{description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
			</div>
			{children}
		</section>
	)
}

/** Claims as calm rows, each with its source chips. */
export function ClaimRows({ claims, empty = "None stated." }: { claims: Claim[]; empty?: string }) {
	if (claims.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>
	return (
		<ul className="divide-y divide-hairline rounded-lg border border-hairline bg-panel">
			{claims.map((claim, i) => (
				<li key={i} className="px-4 py-3 text-sm leading-relaxed text-ink">
					<ClaimText claim={claim} />
				</li>
			))}
		</ul>
	)
}

/** The challenge in the company's own words (its dataset record), or the Analyst's restatement until that loads. */
export function ChallengeText({ index, challengeId, className }: { index: ResultsIndex; challengeId: string; className?: string }) {
	const { source } = useSource(challengeId)
	const text = source?.title ?? index.needs.get(challengeId)?.restatement.text ?? ""
	return <span className={className}>{text}</span>
}

export const FIT_HINT = "Fit of this pair to this one challenge. It compares pairs for the same challenge and never scores a person."

/** "fit 85%": always about a pair, never a person. */
export function PairFit({ fit, className }: { fit: number; className?: string }) {
	return (
		<span title={FIT_HINT} className={cn("tabular whitespace-nowrap", className)}>
			fit {format.percent(fit)}
		</span>
	)
}

/** A detail view's tab, kept in the URL (`?tab=`), so a link can open the Critic review directly. */
export function useTab<T extends string>(values: readonly T[], fallback: T): [T, (tab: T) => void] {
	const [params, setParams] = useSearchParams()
	const raw = params.get("tab") as T | null
	const tab = raw && values.includes(raw) ? raw : fallback
	const set = (next: T) =>
		setParams(
			(prev) => {
				const out = new URLSearchParams(prev)
				if (next === fallback) out.delete("tab")
				else out.set("tab", next)
				return out
			},
			{ replace: true },
		)
	return [tab, set]
}
