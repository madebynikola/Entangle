import { supportedModels } from "@mozaik-ai/core"
import {
	BUDGET,
	BUDGET_SLACK,
	LOCAL_CLAUDE,
	PROVIDER_KEYS,
	PROVIDER_LIMITS,
	ROUTES,
	RUNNER,
	SUBQ,
	type ProviderLimits,
} from "../../config/models"
import type { AgentRole, BudgetLimits } from "../types"

/** config/models.ts with the `.env` overrides applied. Read at call time, after the CLI has loaded `.env`. */

const PROVIDERS = new Map(supportedModels.map((model) => [model.specification.name, model.specification.provider]))

/** `anthropic`, `openai`, `google`, `subq`, ... or `unknown` for a model Mozaik does not list (e.g. a mock name). */
export function providerOf(model: string): string {
	return PROVIDERS.get(model) ?? (model.startsWith("subq-") ? "subq" : "unknown")
}

/** Providers whose key is set. With SUBQ on, only SubQ; with LOCAL_CLAUDE on, only Anthropic, through the local Claude login. */
export function providersWithKeys(): string[] {
	if (subq()) return ["subq"]
	if (localClaude()) return ["anthropic"]
	return Object.entries(PROVIDER_KEYS)
		.filter(([, name]) => process.env[name])
		.map(([provider]) => provider)
}

/** Model calls run as local Claude Code sessions (`claude -p`) on the user's login, not through API keys. */
export function localClaude(): boolean {
	return /^(1|true|yes|on)$/i.test(process.env.LOCAL_CLAUDE ?? "")
}

export interface LocalClaudeSettings {
	sessions: number
	timeoutMs: number
	command: string
}

export function localClaudeSettings(): LocalClaudeSettings {
	return {
		sessions: Math.max(1, envNumber("LOCAL_CLAUDE_SESSIONS", LOCAL_CLAUDE.sessions)),
		timeoutMs: envNumber("LOCAL_CLAUDE_TIMEOUT_MS", LOCAL_CLAUDE.timeoutMs),
		command: process.env.CLAUDE_BIN || LOCAL_CLAUDE.command,
	}
}

/** Model calls go to SubQ's Chat Completions with SUBQ_API_KEY. Wins over LOCAL_CLAUDE. */
export function subq(): boolean {
	return /^(1|true|yes|on)$/i.test(process.env.SUBQ ?? "")
}

export interface SubqSettings {
	baseUrl: string
	apiKey: string | undefined
	model: string
	reasoningEffort: string
}

export function subqSettings(): SubqSettings {
	return {
		baseUrl: process.env.SUBQ_BASE_URL || SUBQ.baseUrl,
		apiKey: process.env.SUBQ_API_KEY,
		model: process.env.SUBQ_MODEL || SUBQ.model,
		reasoningEffort: process.env.SUBQ_REASONING_EFFORT || SUBQ.reasoningEffort,
	}
}

const turns = new Map<AgentRole, number>()

/**
 * The model for a role's next task, from config/models.ts.
 * Only models whose provider has a key; with no key at all (a mock run), every listed model.
 * A spread role takes the next usable model in turn, the others always the first.
 * With SUBQ on, every role runs on SUBQ_MODEL, unless MODEL_<ROLE> pins it to another `subq-` model.
 */
export function modelFor(role: AgentRole): string {
	const pinned = process.env[`MODEL_${role.toUpperCase()}`]
	if (subq()) return pinned?.startsWith("subq-") ? pinned : subqSettings().model
	if (pinned) return pinned
	const route = ROUTES[role]
	const keyed = providersWithKeys()
	const usable = keyed.length ? route.models.filter((model) => keyed.includes(providerOf(model))) : route.models
	if (!usable.length) throw new Error(`No model for ${role}: set a key for one of ${route.models.join(", ")}`)
	if (!route.spread) return usable[0]
	const turn = turns.get(role) ?? 0
	turns.set(role, turn + 1)
	return usable[turn % usable.length]
}

export interface RunnerSettings {
	maxInFlight: number
	maxRetries: number
	baseBackoffMs: number
	maxBackoffMs: number
	maxOutputTokens: number
	budgetSlack: number
}

export function runnerSettings(): RunnerSettings {
	return {
		maxInFlight: Math.max(1, envNumber("MAX_IN_FLIGHT", RUNNER.maxInFlight)),
		maxRetries: envNumber("MAX_RETRIES", RUNNER.maxRetries),
		baseBackoffMs: RUNNER.baseBackoffMs,
		maxBackoffMs: RUNNER.maxBackoffMs,
		maxOutputTokens: RUNNER.maxOutputTokens,
		budgetSlack: envNumber("BUDGET_SLACK", BUDGET_SLACK),
	}
}

export function providerLimits(provider: string): ProviderLimits {
	const limits = PROVIDER_LIMITS[provider] ?? { rpm: 0, itpm: 0 }
	const prefix = provider.toUpperCase()
	return { rpm: envNumber(`${prefix}_RPM`, limits.rpm), itpm: envNumber(`${prefix}_ITPM`, limits.itpm) }
}

export function budgetLimits(): BudgetLimits {
	return {
		maxTokens: envNumber("BUDGET_TOKENS", BUDGET.maxTokens),
		maxCostUsd: envNumber("BUDGET_USD", BUDGET.maxCostUsd),
		maxWallMs: envNumber("BUDGET_MINUTES", BUDGET.maxWallMs / 60_000) * 60_000,
		maxAttempts: envNumber("MAX_ATTEMPTS", BUDGET.maxAttempts),
	}
}

export function mockErrorRate(): number {
	return envNumber("MOCK_ERROR_RATE", RUNNER.mockErrorRate)
}

function envNumber(name: string, fallback: number): number {
	const raw = process.env[name]
	const value = Number(raw)
	return raw && Number.isFinite(value) ? value : fallback
}
