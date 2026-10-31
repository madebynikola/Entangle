import type { StartRunBody } from "@shared/server/api"
import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "@/components/ui/toaster"
import { useBackend } from "@/run/hooks"

/**
 * Start a run on the local server and open its Stage: a mock run by default, or a reverse search with `problem`.
 * `start` resolves true once the run has started. `canStart` is false in a hosted build.
 */
export function useStartRun(): { canStart: boolean; starting: boolean; start: (options?: StartRunBody) => Promise<boolean> } {
	const backend = useBackend()
	const navigate = useNavigate()
	const [starting, setStarting] = useState(false)
	const start = async (options: StartRunBody = { mock: true }) => {
		if (backend?.kind !== "server" || starting) return false
		setStarting(true)
		try {
			const id = await backend.startRun(options)
			const what = options.problem ? "Reverse search" : "Run"
			toast.success(options.mock ? `Mock ${what.toLowerCase()} started` : `${what} started`, { description: "It streams in as the agents work." })
			navigate(`/runs/${encodeURIComponent(id)}/stage`)
			return true
		} catch (error) {
			toast.error("The run did not start", { description: error instanceof Error ? error.message : String(error) })
			return false
		} finally {
			setStarting(false)
		}
	}
	return { canStart: backend?.kind === "server", starting, start }
}
