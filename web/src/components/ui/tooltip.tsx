import { Tooltip as TooltipPrimitive } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

export function TooltipProvider(props: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={150} {...props} />
}

/** <Tooltip content="…"><button/></Tooltip> */
export function Tooltip({
	content,
	side = "top",
	children,
	className,
}: {
	content: React.ReactNode
	side?: "top" | "bottom" | "left" | "right"
	children: React.ReactNode
	className?: string
}) {
	if (content == null || content === "") return <>{children}</>
	return (
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					side={side}
					sideOffset={6}
					className={cn(
						"z-50 max-w-72 rounded-sm bg-ink px-2 py-1 text-sm text-panel data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in",
						className,
					)}
				>
					{content}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	)
}
