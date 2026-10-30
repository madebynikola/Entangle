import { motion } from "motion/react"
import { useId } from "react"
import type * as React from "react"
import { cn } from "@/lib/utils"

/** A small segmented control: replay speed, view modes. */
export function Segmented<V extends string>({
	items,
	value,
	onValueChange,
	className,
	"aria-label": ariaLabel,
}: {
	items: { value: V; label: React.ReactNode; title?: string }[]
	value: V
	onValueChange: (value: V) => void
	className?: string
	"aria-label"?: string
}) {
	const group = useId()
	return (
		<div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex h-7 items-center rounded-md bg-sunken p-0.5", className)}>
			{items.map((item) => {
				const active = item.value === value
				return (
					<button
						key={item.value}
						type="button"
						role="radio"
						aria-checked={active}
						title={item.title}
						onClick={() => onValueChange(item.value)}
						className={cn(
							"relative inline-flex h-6 min-w-8 items-center justify-center gap-1 rounded-[5px] px-2 text-sm transition-colors duration-150 [&_svg]:size-3.5",
							active ? "text-ink" : "text-ink-muted hover:text-ink",
						)}
					>
						{active && (
							<motion.span
								layoutId={`segment-${group}`}
								className="absolute inset-0 rounded-[5px] border border-hairline bg-panel"
								transition={{ type: "spring", stiffness: 560, damping: 44 }}
							/>
						)}
						<span className="tabular relative inline-flex items-center gap-1">{item.label}</span>
					</button>
				)
			})}
		</div>
	)
}
