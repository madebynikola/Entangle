import { Toaster as Sonner } from "sonner"
import { useTheme } from "@/components/shell/theme"

export { toast } from "sonner"

/** Toasts float bottom-right with the one shadow we allow. Say what happened, in the button's words ("Approved"). */
export function Toaster() {
	const { resolved } = useTheme()
	return (
		<Sonner
			theme={resolved}
			position="bottom-right"
			gap={8}
			toastOptions={{
				unstyled: true,
				classNames: {
					toast:
						"flex w-[var(--width)] items-start gap-2.5 rounded-lg border border-hairline bg-card p-3.5 text-base text-ink shadow-float",
					title: "font-medium",
					description: "mt-0.5 text-sm text-ink-muted",
					actionButton: "ml-auto h-7 shrink-0 rounded-md bg-primary px-2.5 text-sm text-primary-foreground",
					cancelButton: "ml-auto h-7 shrink-0 rounded-md border border-hairline px-2.5 text-sm text-ink",
					icon: "mt-0.5 [&_svg]:size-4",
					success: "[&_[data-icon]]:text-working",
					error: "[&_[data-icon]]:text-failed",
					warning: "[&_[data-icon]]:text-needs",
					info: "[&_[data-icon]]:text-info",
				},
			}}
		/>
	)
}
