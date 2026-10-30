import { Switch as SwitchPrimitive } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

/** A toggle: ink when on. */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			className={cn(
				"inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-strong p-0.5 transition-colors duration-150 data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-45",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb className="block size-4 rounded-full bg-white shadow-[0_1px_2px_#0003] transition-transform duration-150 ease-out data-[state=checked]:translate-x-4" />
		</SwitchPrimitive.Root>
	)
}
