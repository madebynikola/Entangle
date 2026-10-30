import { useState } from "react"
import { useNavigate } from "react-router"
import { toast } from "@/components/ui/toaster"
import { useBackend } from "@/run/hooks"

/** Start a mock run on the local server and open its Timeline. `canStart` is false in a hosted build. */
export function useStartRun(): { canStart: boolean; starting: boolean; start: () => Promise<void> } {
	const backend = useBackend()
	const navigate = useNavigate()
	const [starting, setStarting] = useState(false)
	const start = async () => {
		if (backend?.kind !== "server" || starting) return
		setStarting(true)
		try {
			const id = await backend.startRun({ mock: true })
			toast.success("Mock run started", { description: "It streams in as the agents work." })
			navigate(`/runs/${encodeURIComponent(id)}/live`)
		} catch (error) {
			toast.error("The run did not start", { description: error instanceof Error ? error.message : String(error) })
		} finally {
			setStarting(false)
		}
	}
	return { canStart: backend?.kind === "server", starting, start }
}
