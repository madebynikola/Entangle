import type * as React from "react"
import { cn } from "@/lib/utils"
import { SidebarToggle, useSidebar } from "./sidebar"

/**
 * The top of the white panel: the title, one quiet line of facts, actions on the right, and tabs under it.
 * The sidebar button shows here on narrow screens, and on wide ones while the sidebar is hidden.
 */
export function PageHeader({
	title,
	meta,
	actions,
	tabs,
	className,
}: {
	title: React.ReactNode
	meta?: React.ReactNode
	actions?: React.ReactNode
	/** Underlined tabs (Tabs or RouteTabs), drawn on the header's bottom line. */
	tabs?: React.ReactNode
	className?: string
}) {
	const open = useSidebar((state) => state.open)
	return (
		<header className={cn("shrink-0 border-b border-hairline px-4 sm:px-6", className)}>
			<div className={cn("flex min-h-15 flex-wrap items-center gap-x-4 gap-y-2 py-3", tabs && "pb-1")}>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<SidebarToggle className={cn("-ml-1.5", open && "lg:hidden")} />
					<div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
						<h1 className="truncate text-xl font-semibold tracking-tight text-ink">{title}</h1>
						{meta}
					</div>
				</div>
				{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
			</div>
			{tabs}
		</header>
	)
}
