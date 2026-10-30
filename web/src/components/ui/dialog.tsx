import { Dialog as DialogPrimitive } from "radix-ui"
import { X } from "lucide-react"
import type * as React from "react"
import { cn } from "@/lib/utils"

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

function Overlay({ className }: { className?: string }) {
	return (
		<DialogPrimitive.Overlay
			className={cn(
				"fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out dark:bg-black/50",
				className,
			)}
		/>
	)
}

/** A centred dialog like the Kanbix card view: large radius, no heavy chrome. */
export function DialogContent({
	className,
	children,
	hideClose,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
	return (
		<DialogPrimitive.Portal>
			<Overlay />
			<DialogPrimitive.Content
				className={cn(
					"fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-hairline bg-panel p-6 shadow-float outline-none data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
					className,
				)}
				{...props}
			>
				{children}
				{!hideClose && <CloseButton className="absolute right-4 top-4" />}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	)
}

/** A panel that slides in from the right: details, a source record. */
export function SheetContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
	return (
		<DialogPrimitive.Portal>
			<Overlay className="bg-black/10 dark:bg-black/35" />
			<DialogPrimitive.Content
				className={cn(
					"fixed inset-y-2 right-2 z-50 flex w-[min(30rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-hairline bg-panel shadow-float outline-none data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
					className,
				)}
				{...props}
			>
				{children}
				<CloseButton className="absolute right-3 top-3" />
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	)
}

function CloseButton({ className }: { className?: string }) {
	return (
		<DialogPrimitive.Close
			aria-label="Close"
			className={cn("inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-hover hover:text-ink", className)}
		>
			<X className="size-4" />
		</DialogPrimitive.Close>
	)
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn("pr-8 text-xl font-medium text-ink", className)} {...props} />
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("mt-1 text-sm text-ink-muted", className)} {...props} />
}
