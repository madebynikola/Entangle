import { Outlet } from "react-router"
import { Toaster } from "@/components/ui/toaster"
import { CommandPalette } from "./command-palette"
import { SourceSheet } from "./source"
import { ThemeSync } from "./theme"

/** The page frame. Each screen renders its own TopBar, so a run can put its tabs inside it. */
export function AppShell() {
	return (
		<div className="flex min-h-dvh flex-col bg-canvas">
			<ThemeSync />
			<Outlet />
			<CommandPalette />
			<SourceSheet />
			<Toaster />
		</div>
	)
}
