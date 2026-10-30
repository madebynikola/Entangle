import { supportedModels } from "@mozaik-ai/core"
import {
	BUDGET,
	BUDGET_SLACK,
	DECISION_PROVIDERS,
	LOCAL_CLAUDE,
	PROVIDER_KEYS,
	PROVIDER_LIMITS,
	ROUTES,
	RUNNER,
	SCREEN,
	SUBQ,
	type ProviderLimits,
} from "../../config/models"
import type { AgentRole, BudgetLimits } from "../types"

/** config/models.ts with the `.env` overrides applied. Read at call time, after the CLI has loaded `.env`. */

const PROVIDERS = new Map(supportedModels.map((model) => [model.specification.name, model.specification.provider]))

/** `anthropic`, `openai`, `google`, `subq`, `typesafe`, ... or `unknown` for a model Mozaik does not list (e.g. a mock name). */
export function providerOf(model: string): string {
	return PROVIDERS.get(model) ?? decisionProviderOf(model) ?? "unknown"
}

/** `subq` or `typesafe` for a decision model (subq-snap, Jev), which answers typed questions only. */
export function decisionProviderOf(model: string): string | undefined {
	return Object.entries(DECISION_PROVIDERS).find(([, provider]) => model.startsWith(provider.prefix))?.[0]
}

/** Providers whose key is set. With LOCAL_CLAUDE on, only Anthropic, through the local Claude login. */
export function providersWithKeys(): string[] {
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

/** The second Critic runs on a decision model (subq-snap, Jev). */
export function subq(): boolean {
	return /^(1|true|yes|on)$/i.test(process.env.SUBQ ?? "")
}

export interface SubqSettings {
	model: string
	threshold: number
	timeoutMs: number
}

export function subqSettings(): SubqSettings {
	return {
		model: process.env.SUBQ_MODEL || SUBQ.model,
		threshold: envNumber("SUBQ_THRESHOLD", SUBQ.threshold),
		timeoutMs: SUBQ.timeoutMs,
	}
}

/** A decision model rates each shortlist's candidates before they are profiled (subq-snap, Jev). */
export function screen(): boolean {
	return /^(1|true|yes|on)$/i.test(process.env.SCREEN ?? "")
}

export interface ScreenSettings {
	model: string
	widen: number
	threshold: number
}

export function screenSettings(): ScreenSettings {
	return {
		model: process.env.SCREEN_MODEL || SCREEN.model,
		widen: SCREEN.widen,
		threshold: envNumber("SCREEN_THRESHOLD", SCREEN.threshold),
	}
}

/** The endpoint and key for a decision model, or undefined for any other model. */
export function decisionEndpoint(model: string): { baseUrl: string; keyVar: string; apiKey: string | undefined } | undefined {
	const provider = decisionProviderOf(model)
	if (!provider) return undefined
	const { baseUrl, key } = DECISION_PROVIDERS[provider]
	return { baseUrl, keyVar: key, apiKey: process.env[key] }
}

const turns = new Map<AgentRole, number>()

/**
 * The model for a role's next task, from config/models.ts.
 * Only models whose provider has a key; with no key at all (a mock run), every listed model.
 * A spread role takes the next usable model in turn, the others always the first.
 */
export function modelFor(role: AgentRole): string {
	const pinned = process.env[`MODEL_${role.toUpperCase()}`]
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
