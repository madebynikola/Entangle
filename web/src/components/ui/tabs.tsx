import { motion } from "motion/react"
import { useId } from "react"
import type * as React from "react"
import { NavLink } from "react-router"
import { cn } from "@/lib/utils"

export interface TabItem<V extends string = string> {
	value: V
	label: React.ReactNode
	count?: React.ReactNode
	/** For RouteTabs: where the tab goes. */
	to?: string
	disabled?: boolean
}

const tabClass =
	"group relative inline-flex h-11 items-center whitespace-nowrap text-base text-ink-muted transition-colors duration-150 hover:text-ink disabled:pointer-events-none disabled:opacity-40 data-[active=true]:text-ink"

/** The hover pill behind a tab, and the ink underline under the active one. */
function Inner({ item, active, group }: { item: TabItem; active: boolean; group: string }) {
	return (
		<>
			<span className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors duration-150 group-hover:bg-hover">
				<span>{item.label}</span>
				{item.count != null && <span className="tabular text-sm text-ink-subtle">{item.count}</span>}
			</span>
			{active && (
				<motion.span
					layoutId={`tab-underline-${group}`}
					className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-ink"
					transition={{ type: "spring", stiffness: 520, damping: 42 }}
				/>
			)}
		</>
	)
}

/** Underlined tabs with counts, held in state. */
export function Tabs<V extends string>({
	items,
	value,
	onValueChange,
	className,
	"aria-label": ariaLabel,
}: {
	items: TabItem<V>[]
	value: V
	onValueChange: (value: V) => void
	className?: string
	"aria-label"?: string
}) {
	const group = useId()
	return (
		<div role="tablist" aria-label={ariaLabel} className={cn("scrollbar-none -mx-2.5 flex items-end overflow-x-auto border-b border-hairline", className)}>
			{items.map((item) => {
				const active = item.value === value
				return (
					<button
						key={item.value}
						type="button"
						role="tab"
						aria-selected={active}
						data-active={active}
						disabled={item.disabled}
						onClick={() => onValueChange(item.value)}
						className={tabClass}
					>
						<Inner item={item} active={active} group={group} />
					</button>
				)
			})}
		</div>
	)
}

/** The same tabs as links: each item needs `to`. The active one follows the URL. */
export function RouteTabs({ items, className, end }: { items: TabItem[]; className?: string; end?: boolean }) {
	const group = useId()
	return (
		<nav className={cn("scrollbar-none -mx-2.5 flex items-end overflow-x-auto", className)}>
			{items.map((item) => (
				<NavLink key={item.value} to={item.to ?? item.value} end={end} className={tabClass} aria-disabled={item.disabled}>
					{({ isActive }) => (
						<span data-active={isActive} className="contents">
							<Inner item={item} active={isActive} group={group} />
						</span>
					)}
				</NavLink>
			))}
		</nav>
	)
}
