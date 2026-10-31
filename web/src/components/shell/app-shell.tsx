import { motion } from "motion/react"
import { Outlet } from "react-router"
import { Toaster } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import { CommandPalette } from "./command-palette"
import { ProblemDialog } from "./problem-dialog"
import { Sidebar, SidebarDrawer, useSidebar, useSidebarKeys } from "./sidebar"
import { SourceSheet } from "./source"
import { BootSplash } from "./splash"
import { ThemeSync } from "./theme"

/**
 * The frame: the sidebar on the grey canvas, and one white panel inset beside it. The window never scrolls;
 * each screen fits the panel and scrolls only inside its own lists. Below 1024 px the sidebar is a drawer
 * and the panel fills the window.
 */
export function AppShell() {
	const open = useSidebar((state) => state.open)
	useSidebarKeys()
	return (
		<div className="flex h-dvh overflow-hidden bg-canvas">
			<ThemeSync />
			<motion.aside
				initial={false}
				animate={{ width: open ? 248 : 8 }}
				transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
				className="hidden shrink-0 overflow-hidden lg:block"
				aria-hidden={!open}
				inert={!open}
			>
				<motion.div initial={false} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.15 }} className="h-full w-62">
					<Sidebar />
				</motion.div>
			</motion.aside>
			<SidebarDrawer />

			<main
				className={cn(
					"relative flex min-w-0 flex-1 flex-col overflow-hidden bg-panel",
					"lg:my-2 lg:mr-2 lg:rounded-xl lg:border lg:border-hairline lg:shadow-card",
				)}
			>
				<Outlet />
			</main>

			<CommandPalette />
			<ProblemDialog />
			<SourceSheet />
			<Toaster />
			<BootSplash />
		</div>
	)
}
