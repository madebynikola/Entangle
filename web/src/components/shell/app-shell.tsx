import { Dialog as DialogPrimitive } from "radix-ui"
import { Menu } from "lucide-react"
import { useState } from "react"
import { Outlet } from "react-router"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/toaster"
import { CommandPalette } from "./command-palette"
import { Mark, Sidebar } from "./sidebar"
import { SourceSheet } from "./source"
import { ThemeSync } from "./theme"

/**
 * The Kanbix frame: the sidebar sits on the grey canvas; the screen lives in one white panel inset with a large radius.
 * Below md the sidebar becomes a drawer behind a menu button.
 */
export function AppShell() {
	const [drawer, setDrawer] = useState(false)
	return (
		<div className="flex h-dvh min-h-0 flex-col bg-canvas md:flex-row">
			<ThemeSync />
			<aside className="hidden w-64 shrink-0 md:block">
				<Sidebar />
			</aside>

			<header className="flex h-12 shrink-0 items-center gap-2 px-2 md:hidden">
				<DialogPrimitive.Root open={drawer} onOpenChange={setDrawer}>
					<DialogPrimitive.Trigger asChild>
						<Button variant="quiet" size="icon" aria-label="Open the menu">
							<Menu />
						</Button>
					</DialogPrimitive.Trigger>
					<DialogPrimitive.Portal>
						<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
						<DialogPrimitive.Content
							aria-describedby={undefined}
							className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-canvas shadow-float outline-none data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
						>
							<DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
							<Sidebar onNavigate={() => setDrawer(false)} />
						</DialogPrimitive.Content>
					</DialogPrimitive.Portal>
				</DialogPrimitive.Root>
				<Mark className="size-6" />
				<span className="font-medium">Entangle</span>
			</header>

			<main className="relative mx-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-panel md:my-2 md:ml-0">
				<Outlet />
			</main>

			<CommandPalette />
			<SourceSheet />
			<Toaster />
		</div>
	)
}
