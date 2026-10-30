import { RuntimeState } from "@mozaik-ai/core"
import type {
	Budget,
	BudgetLimits,
	CompanyNeed,
	CriticVerdict,
	NoMatch,
	PairCandidate,
	Proposal,
	ResearcherProfile,
	Task,
} from "../types"

export const DEFAULT_LIMITS: BudgetLimits = {
	maxTokens: 3_000_000,
	maxCostUsd: 20,
	maxWallMs: 30 * 60_000,
	maxAttempts: 3,
}

/** What the runtime knows about one Mozaik loop. */
export interface LoopInfo {
	loopId: string
	agentId: string
	taskId?: string
	model?: string
}

/**
 * The blackboard every participant shares. Agents read and write it from their
 * situation processors; the trace and the web app read it.
 * Keyed by dataset id (researcherId, challengeId, pair id, proposal id).
 */
export class MatchState extends RuntimeState {
	readonly tasks = new Map<string, Task>()
	readonly profiles = new Map<string, ResearcherProfile>()
	readonly needs = new Map<string, CompanyNeed>()
	readonly candidates = new Map<string, PairCandidate>()
	readonly noMatches = new Map<string, NoMatch>()
	readonly proposals = new Map<string, Proposal>()
	readonly verdicts: CriticVerdict[] = []
	readonly budget: Budget

	/** Model context id → task id. Set by runTask, read when a loop starts. */
	readonly contextTasks = new Map<string, string>()
	/** Loop id → loop info. Filled by the task tracker from loop events. */
	readonly loops = new Map<string, LoopInfo>()
	taskSeq = 0

	constructor(
		readonly runId: string,
		readonly mock: boolean,
		limits: Partial<BudgetLimits> = {},
	) {
		super()
		this.budget = { ...DEFAULT_LIMITS, ...limits, tokensUsed: 0, costUsd: 0, startedAt: Date.now() }
	}

	/** The first budget limit the run has hit, or null. */
	budgetExceeded(): string | null {
		const b = this.budget
		if (b.tokensUsed >= b.maxTokens) return `tokens ${b.tokensUsed} >= ${b.maxTokens}`
		if (b.costUsd >= b.maxCostUsd) return `cost $${b.costUsd.toFixed(2)} >= $${b.maxCostUsd}`
		if (Date.now() - b.startedAt >= b.maxWallMs) return `wall clock >= ${b.maxWallMs} ms`
		return null
	}
}
