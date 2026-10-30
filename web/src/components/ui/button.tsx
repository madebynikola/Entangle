import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

/** Primary is ink on paper (one per view). Outline is the everyday button. Ghost and quiet sit in toolbars. */
export const buttonVariants = cva(
	"inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				primary: "bg-primary text-primary-foreground hover:opacity-85",
				outline: "border border-hairline bg-panel text-ink shadow-card hover:border-strong hover:bg-hover",
				ghost: "text-ink hover:bg-hover",
				quiet: "text-ink-muted hover:bg-hover hover:text-ink",
				danger: "border border-hairline bg-panel text-failed shadow-card hover:border-failed/40 hover:bg-failed/8",
			},
			size: {
				sm: "h-8 px-3 text-sm",
				md: "h-9 px-3.5 text-base",
				lg: "h-10 px-4 text-base",
				icon: "size-9",
				"icon-sm": "size-8",
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
