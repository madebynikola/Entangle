import type * as React from "react"
import { cn } from "@/lib/utils"

export type StatusTone = "working" | "needs" | "info" | "idle" | "failed" | "done"

const TEXT: Record<StatusTone, string> = {
	working: "text-working",
	needs: "text-needs",
	info: "text-info",
	idle: "text-ink-muted",
	failed: "text-failed",
	done: "text-ink-muted",
}

const DOT: Record<StatusTone, string> = {
	working: "bg-working text-working",
	needs: "bg-needs text-needs",
	info: "bg-info text-info",
	idle: "bg-idle text-idle",
	failed: "bg-failed text-failed",
	done: "bg-working text-working",
}

/** A round status dot. Round always means status; roles use squares. */
export function StatusDot({ tone, pulse, className }: { tone: StatusTone; pulse?: boolean; className?: string }) {
	return (
		<span
			aria-hidden
			data-slot="status-dot"
			className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], pulse && "animate-pulse-dot", className)}
		/>
	)
}

/** Dot plus coloured text: "● working: profile R0012". */
export function Status({
	tone,
	pulse,
	className,
	children,
	...props
}: React.ComponentProps<"span"> & { tone: StatusTone; pulse?: boolean }) {
	return (
		<span data-slot="status" className={cn("inline-flex min-w-0 items-center gap-2", TEXT[tone], className)} {...props}>
			<StatusDot tone={tone} pulse={pulse} />
			<span className="truncate">{children}</span>
		</span>
	)
}

/** Dot plus a plain label: the status of a run or a stage ("● Finished"). The text stays ink; the dot carries the colour. */
export function StatusLabel({ tone, pulse, children, className }: { tone: StatusTone; pulse?: boolean; children: React.ReactNode; className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-2 text-ink", className)}>
			<StatusDot tone={tone} pulse={pulse} />
			{children}
		</span>
	)
}
