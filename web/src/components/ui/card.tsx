import type * as React from "react"
import { cn } from "@/lib/utils"

/** White card, hairline border, a whisper of shadow in light mode. */
export function Card({ className, interactive, ...props }: React.ComponentProps<"div"> & { interactive?: boolean }) {
	return (
		<div
			data-slot="card"
			className={cn(
				"rounded-lg border border-hairline bg-card p-5 shadow-card",
				interactive && "cursor-pointer transition-colors duration-150 hover:border-strong",
				className,
			)}
			{...props}
		/>
	)
}

/** A short mono id at the top of a card. */
export function CardId({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("font-mono text-xs text-ink-muted", className)} {...props} />
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
	return <h3 className={cn("text-base font-medium leading-snug text-ink", className)} {...props} />
}

/** Secondary lines under a title. */
export function CardMeta({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("text-sm text-ink-muted", className)} {...props} />
}

/** A titled block of a page: a heading with an optional description and action, then its content. */
export function Section({
	title,
	description,
	action,
	className,
	children,
}: {
	title: React.ReactNode
	description?: React.ReactNode
	action?: React.ReactNode
	className?: string
	children: React.ReactNode
}) {
	return (
		<section className={cn("flex min-w-0 flex-col gap-3", className)}>
			<header className="flex items-end justify-between gap-4">
				<div className="min-w-0">
					<h2 className="text-base font-semibold text-ink">{title}</h2>
					{description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
				</div>
				{action}
			</header>
			{children}
		</section>
	)
}

/**
 * A titled tile that shares the screen's height with others: a header row, then a body that fills the rest.
 * `scroll` lets the body scroll on its own, for lists. The screen itself does not scroll.
 */
export function Pane({
	title,
	description,
	count,
	action,
	scroll,
	className,
	bodyClassName,
	children,
}: {
	title: React.ReactNode
	/** One short line; it is cut to fit, and shows whole on hover. */
	description?: string
	count?: React.ReactNode
	action?: React.ReactNode
	scroll?: boolean
	className?: string
	bodyClassName?: string
	children: React.ReactNode
}) {
	return (
		<section
			data-slot="pane"
			className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-hairline bg-card shadow-card", className)}
		>
			<header className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline pl-4 pr-2">
				<h2 className="shrink-0 text-base font-medium text-ink">{title}</h2>
				{count != null && <span className="tabular text-sm text-ink-subtle">{count}</span>}
				{description && (
					<p title={description} className="ml-1 min-w-0 truncate text-sm text-ink-subtle">
						{description}
					</p>
				)}
				{action && <div className="ml-auto flex shrink-0 items-center gap-1">{action}</div>}
			</header>
			<div className={cn("relative min-h-0 flex-1", scroll && "scrollbar-thin overflow-y-auto", bodyClassName)}>{children}</div>
		</section>
	)
}

/** A titled container that holds cards or rows: a column, a group of swimlanes. */
export function Lane({
	title,
	count,
	icon,
	action,
	className,
	children,
	...props
}: React.ComponentProps<"section"> & { title?: React.ReactNode; count?: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }) {
	return (
		<section data-slot="lane" className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
			{title != null && (
				<header className="flex h-8 items-center gap-2">
					{icon}
					<h2 className="text-sm font-medium text-ink">{title}</h2>
					{count != null && <span className="tabular text-sm text-ink-subtle">{count}</span>}
					<div className="ml-auto">{action}</div>
				</header>
			)}
			<div className="flex flex-col gap-2">{children}</div>
		</section>
	)
}

/** A label over a value: "Duration / 2m 43s". */
export function Stat({ label, value, hint, className }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; className?: string }) {
	return (
		<div className={cn("min-w-0", className)}>
			<div className="text-sm text-ink-muted">{label}</div>
			<div className="tabular mt-1 truncate text-base font-medium text-ink">{value}</div>
			{hint && <div className="mt-0.5 truncate text-xs text-ink-subtle">{hint}</div>}
		</div>
	)
}

/** Secondary facts in one quiet line, joined by middle dots. */
export function Meta({ items, className }: { items: React.ReactNode[]; className?: string }) {
	const shown = items.filter((item) => item != null && item !== false && item !== "")
	return (
		<div data-slot="meta" className={cn("tabular flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted", className)}>
			{shown.map((item, i) => (
				<span key={i} className="inline-flex items-center gap-1.5">
					{i > 0 && <span aria-hidden className="text-ink-subtle">·</span>}
					{item}
				</span>
			))}
		</div>
	)
}
