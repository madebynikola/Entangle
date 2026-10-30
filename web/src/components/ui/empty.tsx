import type * as React from "react"
import { cn } from "@/lib/utils"

/** An empty screen says what is missing and what to do next. */
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
		<div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
			{icon && <div className="mb-4 text-ink-subtle [&_svg]:size-6">{icon}</div>}
			<h3 className="text-md font-medium text-ink">{title}</h3>
			{children && <div className="mt-1.5 max-w-sm text-base text-ink-muted">{children}</div>}
			{action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
		</div>
	)
}
