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
	"relative inline-flex h-10 items-center gap-1.5 whitespace-nowrap text-lg text-ink-muted transition-colors duration-150 hover:text-ink disabled:pointer-events-none disabled:opacity-45 data-[active=true]:text-ink"

function Underline({ group }: { group: string }) {
	return (
		<motion.span
			layoutId={`tab-underline-${group}`}
			className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
			transition={{ type: "spring", stiffness: 520, damping: 42 }}
		/>
	)
}

function Label({ item }: { item: TabItem }) {
	return (
		<>
			<span>{item.label}</span>
			{item.count != null && <span className="tabular text-ink-muted">{item.count}</span>}
		</>
	)
}

/** Underlined tabs with counts ("All 9 · Claude 8 · You 1"), held in state. */
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
		<div role="tablist" aria-label={ariaLabel} className={cn("flex items-end gap-6 border-b border-hairline", className)}>
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
						<Label item={item} />
						{active && <Underline group={group} />}
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
		<nav className={cn("flex items-end gap-6 border-b border-hairline", className)}>
			{items.map((item) => (
				<NavLink
					key={item.value}
					to={item.to ?? item.value}
					end={end}
					className={tabClass}
					aria-disabled={item.disabled}
				>
					{({ isActive }) => (
						<span data-active={isActive} className="contents">
							<Label item={item} />
							{isActive && <Underline group={group} />}
						</span>
					)}
				</NavLink>
			))}
		</nav>
	)
}
