import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

/** Kanbix buttons are mostly outlined with a hairline; filled primary is for the one main action on a screen. */
export const buttonVariants = cva(
	"inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-normal transition-[background-color,border-color,color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				outline: "border border-hairline bg-panel text-ink hover:border-strong hover:bg-hover",
				primary: "bg-primary text-primary-foreground hover:opacity-90",
				ghost: "text-ink hover:bg-hover",
				quiet: "text-ink-muted hover:bg-hover hover:text-ink",
				danger: "border border-hairline bg-panel text-failed hover:border-failed/40 hover:bg-failed/8",
			},
			size: {
				sm: "h-7 px-2.5 text-sm",
				md: "h-8 px-3 text-base",
				lg: "h-10 px-4 text-md",
				icon: "size-8",
				"icon-sm": "size-7",
			},
		},
		defaultVariants: { variant: "outline", size: "md" },
	},
)

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
	const Comp = asChild ? Slot.Root : "button"
	return (
		<Comp
			data-slot="button"
			type={asChild ? undefined : (type ?? "button")}
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	)
}
