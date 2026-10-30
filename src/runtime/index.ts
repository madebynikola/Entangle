import type { InferenceRunner } from "@mozaik-ai/core"
import type { BudgetLimits } from "../types"
import { MockInferenceRunner } from "./mock-runner"
import { initializeRuntime, join } from "./mozaik"
import { MatchState } from "./state"
import { createTaskTracker } from "./tasks"

export * from "./mozaik"
export * from "./state"
export * from "./tasks"
export * from "./mock-runner"
export { costUsd } from "./pricing"

export interface RuntimeOptions {
	runId: string
	/** Use the mock runner: fake latency, no API calls. */
	mock: boolean
	budget?: Partial<BudgetLimits>
	/** Overrides the runner choice, e.g. a rate-limited wrapper or a mock with responders. */
	runner?: InferenceRunner
}

/**
 * Initialize the one Mozaik runtime and join the task tracker.
 * Join the trace observer next, then the agents.
 */
export function startRuntime(options: RuntimeOptions): MatchState {
	const state = new MatchState(options.runId, options.mock, options.budget)
	const runner = options.runner ?? (options.mock ? new MockInferenceRunner() : undefined)
	initializeRuntime({ state, inferenceRunnerConfig: runner ? { runner } : undefined })
	join(createTaskTracker())
	return state
}
