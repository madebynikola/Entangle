import type * as React from "react"
import { cn } from "@/lib/utils"

/** White card, hairline border, small radius, roomy padding. No shadow. */
export function Card({ className, interactive, ...props }: React.ComponentProps<"div"> & { interactive?: boolean }) {
	return (
		<div
			data-slot="card"
			className={cn(
				"rounded-md border border-hairline bg-card p-4",
				interactive && "cursor-pointer transition-colors duration-150 hover:border-strong",
				className,
			)}
			{...props}
		/>
	)
}

/** "#12" style id line at the top of a card. */
export function CardId({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("font-mono text-xs text-ink-muted", className)} {...props} />
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
	return <h3 className={cn("text-md font-medium leading-snug text-ink", className)} {...props} />
}

/** Secondary lines under a title. */
export function CardMeta({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("text-sm text-ink-muted", className)} {...props} />
}

/** Soft grey rounded container that holds cards: a Kanbix column, a swimlane group. */
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
		<section data-slot="lane" className={cn("flex min-w-0 flex-col rounded-lg bg-sunken p-2", className)} {...props}>
			{title != null && (
				<header className="flex h-10 items-center gap-2 px-2.5">
					{icon}
					<h2 className="font-medium text-ink">{title}</h2>
					{count != null && <span className="tabular text-ink-muted">{count}</span>}
					<div className="ml-auto">{action}</div>
				</header>
			)}
			<div className="flex flex-col gap-2">{children}</div>
		</section>
	)
}

/** Every metric in one muted line, joined by middle dots: "61k / 200k · 388k spent · ~$0.42". */
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
