import type * as React from "react"
import { cn } from "@/lib/utils"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			className={cn(
				"h-9 w-full min-w-0 rounded-md border border-hairline bg-panel px-3 text-base text-ink outline-none transition-colors duration-150 placeholder:text-ink-subtle hover:border-strong focus-visible:border-link focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-link/15",
				className,
			)}
			{...props}
		/>
	)
}
