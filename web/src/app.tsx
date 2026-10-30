import { Compass } from "lucide-react"
import { Link, Navigate, createHashRouter } from "react-router"
import { AppShell } from "@/components/shell/app-shell"
import { RunLayout } from "@/components/shell/run-layout"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty"
import { HomeScreen } from "@/screens/home"

/**
 * Routes. Hash routing, so a static build works on any host (GitHub Pages) with no rewrites.
 *
 *   #/                         all runs
 *   #/runs/:runId/live/*       live run view (#20 owns screens/live)
 *   #/runs/:runId/results/*    results view (#21 owns screens/results); nest your own <Routes> under it
 */
export const router = createHashRouter([
	{
		element: <AppShell />,
		hydrateFallbackElement: <div className="h-dvh bg-canvas" />,
		children: [
			{ index: true, element: <HomeScreen /> },
			{
				path: "runs/:runId",
				element: <RunLayout />,
				children: [
					{ index: true, element: <Navigate to="live" replace /> },
					// Loaded on first visit, so each screen's weight stays out of the first page load.
					{ path: "live/*", lazy: async () => ({ Component: (await import("@/screens/live")).LiveScreen }) },
					{ path: "results/*", lazy: async () => ({ Component: (await import("@/screens/results")).ResultsScreen }) },
				],
			},
			{ path: "*", element: <NotFound /> },
		],
	},
])

function NotFound() {
	return (
		<EmptyState
			className="flex-1"
			icon={<Compass />}
			title="There is nothing at this address"
			action={
				<Button asChild>
					<Link to="/">See all runs</Link>
				</Button>
			}
		>
			The link may point to a run that is not on this machine.
		</EmptyState>
	)
}
