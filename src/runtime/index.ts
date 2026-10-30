import type { InferenceRunner } from "@mozaik-ai/core"
import type { BudgetLimits } from "../types"
import { ClaudeCodeRunner } from "./claude-code-runner"
import { budgetLimits, localClaude, mockErrorRate, providersWithKeys } from "./config"
import { MockInferenceRunner } from "./mock-runner"
import { initializeRuntime, join } from "./mozaik"
import { ResilientRunner, defaultInferenceRunner } from "./resilient-runner"
import { MatchState } from "./state"
import { SnapRunner } from "./snap-runner"
import { createTaskTracker } from "./tasks"

export * from "./mozaik"
export * from "./state"
export * from "./tasks"
export * from "./mock-runner"
export { costUsd } from "./pricing"
export { decisionEndpoint, decisionProviderOf, localClaude, modelFor, providerOf, providersWithKeys, subq, subqSettings } from "./config"
export { ClaudeCodeRunner } from "./claude-code-runner"
export { SnapRunner, type Decider, type Decision, type DecisionAnswer, type DecisionQuestion } from "./snap-runner"
export { ResilientRunner, defaultInferenceRunner } from "./resilient-runner"

/** A runner of this type under the runtime's runner, which may wrap it (the ResilientRunner keeps it as `inner`). */
export function innerOf<T extends InferenceRunner>(runner: InferenceRunner | undefined, type: new (...args: never[]) => T): T | undefined {
	for (let depth = 0; runner && depth < 4; depth++) {
		if (runner instanceof type) return runner
		runner = (runner as { inner?: InferenceRunner }).inner
	}
	return undefined
}

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
 * Calls to a decision model (subq-snap, Jev) go to its own API through the SnapRunner, except in a mock run.
 * Join the trace observer next, then the agents.
 */
export function startRuntime(options: RuntimeOptions): MatchState {
	const mock = options.mock || providersWithKeys().length === 0
	const state = new MatchState(options.runId, mock, { ...budgetLimits(), ...options.budget })
	const inner =
		options.runner ??
		(mock
			? new MockInferenceRunner({ errorRate: mockErrorRate() })
			: new SnapRunner(localClaude() ? new ClaudeCodeRunner() : defaultInferenceRunner()))
	initializeRuntime({ state, inferenceRunnerConfig: { runner: new ResilientRunner(inner) } })
	const tracker = createTaskTracker()
	join(tracker)
	state.trackerId = tracker.getId()
	return state
}
