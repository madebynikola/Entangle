import { Slot } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

export interface ChipProps extends React.ComponentProps<"span"> {
	icon?: React.ReactNode
	/** A count after the label, in the ink colour: "Checks 2". */
	count?: React.ReactNode
	tone?: "default" | "primary" | "needs" | "failed" | "working"
	/** Renders the child (a button or link) with chip styles and a hover state. */
	asChild?: boolean
	mono?: boolean
}

const TONE: Record<NonNullable<ChipProps["tone"]>, string> = {
	default: "text-ink-muted",
	primary: "border-primary/35 text-primary",
	needs: "border-needs/40 text-needs",
	failed: "border-failed/40 text-failed",
	working: "border-working/40 text-working",
}

/** Outlined pill with a hairline border: dates, counts, settings, source ids. */
export function Chip({ icon, count, tone = "default", asChild, mono, className, children, ...props }: ChipProps) {
	const Comp = asChild ? Slot.Root : "span"
	return (
		<Comp
			data-slot="chip"
			className={cn(
				"inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-hairline bg-panel px-2 text-sm [&_svg]:size-3.5 [&_svg]:shrink-0",
				asChild && "cursor-pointer transition-colors duration-150 hover:border-strong hover:bg-hover hover:text-ink",
				mono && "font-mono text-xs",
				TONE[tone],
				className,
			)}
			{...props}
		>
			{asChild ? (
				children
			) : (
				<>
					{icon}
					{children != null && <span className="truncate">{children}</span>}
					{count != null && <span className="tabular text-ink">{count}</span>}
				</>
			)}
		</Comp>
	)
}
