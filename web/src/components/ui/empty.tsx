import type * as React from "react"
import { cn } from "@/lib/utils"

/** An empty view says what is missing and what to do next. */
export function EmptyState({
	icon,
	title,
	children,
	action,
	className,
}: {
	icon?: React.ReactNode
	title: React.ReactNode
	children?: React.ReactNode
	action?: React.ReactNode
	className?: string
}) {
	return (
		<div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}>
			{icon && (
				<div className="mb-4 flex size-10 items-center justify-center rounded-lg border border-hairline bg-panel text-ink-muted shadow-card [&_svg]:size-5">
					{icon}
				</div>
			)}
			<h3 className="text-base font-semibold text-ink">{title}</h3>
			{children && <div className="mt-1.5 max-w-md text-base text-ink-muted">{children}</div>}
			{action && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{action}</div>}
		</div>
	)
}
