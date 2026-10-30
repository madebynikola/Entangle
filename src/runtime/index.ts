import type { InferenceRunner } from "@mozaik-ai/core"
import type { BudgetLimits } from "../types"
import { ClaudeCodeRunner } from "./claude-code-runner"
import { budgetLimits, localClaude, mockErrorRate, providersWithKeys } from "./config"
import { MockInferenceRunner } from "./mock-runner"
import { initializeRuntime, join } from "./mozaik"
import { ResilientRunner, defaultInferenceRunner } from "./resilient-runner"
import { MatchState } from "./state"
import { createTaskTracker } from "./tasks"

export * from "./mozaik"
export * from "./state"
export * from "./tasks"
export * from "./mock-runner"
export { costUsd } from "./pricing"
export { localClaude, modelFor, providerOf, providersWithKeys } from "./config"
export { ClaudeCodeRunner } from "./claude-code-runner"
export { ResilientRunner, defaultInferenceRunner } from "./resilient-runner"

export interface RuntimeOptions {
	runId: string
	/** Use the mock runner: fake latency, no API calls. Also the default when no provider key is set and LOCAL_CLAUDE is off. */
	mock: boolean
	/** Overrides the budget in config/models.ts and `.env`. */
	budget?: Partial<BudgetLimits>
	/** Overrides the runner choice, e.g. a mock with responders. It still runs behind the ResilientRunner. */
	runner?: InferenceRunner
}

/**
 * Initialize the one Mozaik runtime and join the task tracker.
 * Every model call goes through the ResilientRunner: rate limits, retries, budget stop.
 * With LOCAL_CLAUDE on, the calls run as local Claude Code sessions instead of API calls.
 * Join the trace observer next, then the agents.
 */
export function startRuntime(options: RuntimeOptions): MatchState {
	const mock = options.mock || providersWithKeys().length === 0
	const state = new MatchState(options.runId, mock, { ...budgetLimits(), ...options.budget })
	const inner =
		options.runner ??
		(mock ? new MockInferenceRunner({ errorRate: mockErrorRate() }) : localClaude() ? new ClaudeCodeRunner() : defaultInferenceRunner())
	initializeRuntime({ state, inferenceRunnerConfig: { runner: new ResilientRunner(inner) } })
	const tracker = createTaskTracker()
	join(tracker)
	state.trackerId = tracker.getId()
	return state
}
