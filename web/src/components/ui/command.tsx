import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"
import type * as React from "react"
import { cn } from "@/lib/utils"

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return <CommandPrimitive className={cn("flex h-full w-full flex-col overflow-hidden text-ink", className)} {...props} />
}

export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div className="flex h-12 items-center gap-2.5 border-b border-hairline px-4">
			<Search className="size-4 shrink-0 text-ink-subtle" />
			<CommandPrimitive.Input
				className={cn("h-full w-full bg-transparent text-md text-ink outline-none placeholder:text-ink-subtle", className)}
				{...props}
			/>
		</div>
	)
}

export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			className={cn("scrollbar-thin max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain p-1.5", className)}
			{...props}
		/>
	)
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return <CommandPrimitive.Empty className="px-3 py-8 text-center text-sm text-ink-muted" {...props} />
}

export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			className={cn(
				"[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-muted",
				className,
			)}
			{...props}
		/>
	)
}

export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
	return (
		<CommandPrimitive.Item
			className={cn(
				"flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-base text-ink outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-hover data-[disabled=true]:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted",
				className,
			)}
			{...props}
		/>
	)
}

export function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
	return <span className={cn("ml-auto text-xs text-ink-subtle", className)} {...props} />
}
