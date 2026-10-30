import type * as React from "react"
import { cn } from "@/lib/utils"

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			aria-hidden
			className={cn(
				"animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--sunken)_0%,var(--hover)_50%,var(--sunken)_100%)] bg-[length:200%_100%]",
				className,
			)}
			{...props}
		/>
	)
}

export function Spinner({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 16 16" aria-hidden className={cn("size-4 animate-spin text-ink-subtle", className)}>
			<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
			<path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

/** A loading block that keeps the layout: a line of text plus placeholder rows. */
export function LoadingState({ label = "Loading", rows = 3, className }: { label?: string; rows?: number; className?: string }) {
	return (
		<div role="status" aria-live="polite" className={cn("flex flex-col gap-3", className)}>
			<div className="flex items-center gap-2 text-sm text-ink-muted">
				<Spinner />
				{label}
			</div>
			{Array.from({ length: rows }, (_, i) => (
				<Skeleton key={i} className="h-16" style={{ opacity: 1 - i * 0.22 }} />
			))}
		</div>
	)
}
