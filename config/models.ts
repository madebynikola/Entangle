import type { AgentRole, BudgetLimits } from "../src/types"

/**
 * Which model each role runs on, and the limits every model call goes through.
 * One place to tune a run. The name in [brackets] overrides a value from `.env`.
 */

export interface RoleRoute {
	/** Models in order of preference, one per provider. Only models whose provider has a key are used. */
	models: string[]
	/** Rotate over every usable model, to spread many parallel workers over the providers' rate limits. Else use the first. */
	spread: boolean
}

/** [MODEL_<ROLE>] pins one role to one model, e.g. MODEL_CRITIC=claude-haiku-4-5. */
export const ROUTES: Record<AgentRole, RoleRoute> = {
	// Many parallel workers: cheap tier, spread over every provider with a key.
	profiler: { models: ["claude-haiku-4-5", "gpt-5.4-mini", "gemini-3.5-flash"], spread: true },
	analyst: { models: ["claude-haiku-4-5", "gpt-5.4-mini", "gemini-3.5-flash"], spread: true },
	orchestrator: { models: ["claude-haiku-4-5", "gpt-5.4-mini", "gemini-3.5-flash"], spread: false },
	// Few calls that decide quality: one strong model, so all pairs, proposals and reviews read the same way.
	// The Anthropic models are the ones the hackathon expects: Sonnet 4.6 here, Haiku 4.5 for the workers.
	matchmaker: { models: ["claude-sonnet-4-6", "gpt-5.5", "gemini-3.1-pro-preview"], spread: false },
	writer: { models: ["claude-sonnet-4-6", "gpt-5.5", "gemini-3.1-pro-preview"], spread: false },
	critic: { models: ["claude-sonnet-4-6", "gpt-5.5", "gemini-3.1-pro-preview"], spread: false },
}

/** The env var that holds each provider's key, as Mozaik's endpoints read it. */
export const PROVIDER_KEYS: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	google: "GEMINI_API_KEY",
}

export interface ProviderLimits {
	/** Requests per minute [<PROVIDER>_RPM, e.g. ANTHROPIC_RPM]. 0 turns the limit off. */
	rpm: number
	/** Input tokens per minute, estimated before the call as chars / 4 [<PROVIDER>_ITPM]. 0 turns the limit off. */
	itpm: number
}

/** Set these to your account tier. Above them the provider answers 429 and the runner backs off. */
export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
	anthropic: { rpm: 1000, itpm: 400_000 },
	openai: { rpm: 500, itpm: 500_000 },
	google: { rpm: 1000, itpm: 1_000_000 },
}

export const RUNNER = {
	/** Model calls in flight at once, over all providers [MAX_IN_FLIGHT]. */
	maxInFlight: 16,
	/** Retries per call on 429, 5xx and network errors [MAX_RETRIES]. The provider SDKs also retry twice inside each attempt. */
	maxRetries: 4,
	/** The first backoff; it doubles per retry, with jitter, up to maxBackoffMs. A retry-after header wins. */
	baseBackoffMs: 2000,
	maxBackoffMs: 60_000,
	/** For calls that set no maxOutputTokens. Anthropic requires one, and Mozaik 4.1.0 sets no default. */
	maxOutputTokens: 4096,
	/** Share of calls the mock fails with a fake 429 or 529, to show retries with no keys [MOCK_ERROR_RATE]. */
	mockErrorRate: 0,
}

/**
 * Local Claude Code sessions instead of API keys [LOCAL_CLAUDE=1, or `--local`]: every model call runs as
 * `claude -p` on your own Claude login, the way Kanbix starts sessions. Only Claude models are used.
 */
export const LOCAL_CLAUDE = {
	/** `claude -p` processes at once, under MAX_IN_FLIGHT [LOCAL_CLAUDE_SESSIONS]. Each is a Node process of about 200 MB. */
	sessions: 6,
	/** A session that runs longer is stopped and retried [LOCAL_CLAUDE_TIMEOUT_MS]. */
	timeoutMs: 5 * 60_000,
	/** The Claude Code executable [CLAUDE_BIN]. */
	command: "claude",
}

/** [BUDGET_TOKENS, BUDGET_USD, BUDGET_MINUTES, MAX_ATTEMPTS] */
export const BUDGET: BudgetLimits = {
	maxTokens: 6_000_000,
	maxCostUsd: 20,
	maxWallMs: 45 * 60_000,
	maxAttempts: 3,
}

/**
 * At the budget, new tasks are refused. Running tasks may go this share past it to finish their loop;
 * after that the runner refuses their calls too [BUDGET_SLACK].
 */
export const BUDGET_SLACK = 0.1
