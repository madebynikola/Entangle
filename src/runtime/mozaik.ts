import { defineRuntime } from "@mozaik-ai/core"
import type { MatchState } from "./state"

/** The one Mozaik runtime of this process. Import these functions; never call defineRuntime again. */
export const { initializeRuntime, resolveRuntime, resolveParticipant, join, leave, sendMessage, sendEvent, runLoop } =
	defineRuntime<MatchState>()

export function state(): MatchState {
	return resolveRuntime().state
}
