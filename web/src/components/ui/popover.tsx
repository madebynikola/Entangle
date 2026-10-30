import { HoverCard as HoverCardPrimitive, Popover as PopoverPrimitive } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

const floating =
	"z-50 rounded-lg border border-hairline bg-card text-ink shadow-float outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out"

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content sideOffset={sideOffset} className={cn(floating, "w-80 p-4", className)} {...props} />
		</PopoverPrimitive.Portal>
	)
}

export const HoverCard = HoverCardPrimitive.Root
export const HoverCardTrigger = HoverCardPrimitive.Trigger

export function HoverCardContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
	return (
		<HoverCardPrimitive.Portal>
			<HoverCardPrimitive.Content sideOffset={sideOffset} className={cn(floating, "w-80 p-4", className)} {...props} />
		</HoverCardPrimitive.Portal>
	)
}
