import { RuntimeState } from "@mozaik-ai/core"
import { BUDGET } from "../../config/models"
import type {
	Budget,
	BudgetLimits,
	CompanyNeed,
	CriticVerdict,
	FundingMatch,
	NoMatch,
	PairCandidate,
	Proposal,
	ResearcherProfile,
	Task,
} from "../types"

/** Without `.env` overrides; startRuntime() applies those (see config/models.ts). */
export const DEFAULT_LIMITS: BudgetLimits = BUDGET

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
	/** Open EU calls per chosen pair, from the Funding Scout. Keyed by pair id. */
	readonly funding = new Map<string, FundingMatch>()
	readonly verdicts: CriticVerdict[] = []
	readonly budget: Budget

	/** Model context id → task id. Set by runTask, read when a loop starts. */
	readonly contextTasks = new Map<string, string>()
	/** Model context id → loop id. Lets the runner, which only sees the context, name the loop. */
	readonly contextLoops = new Map<string, string>()
	/** Loop id → loop info. Filled by the task tracker from loop events. */
	readonly loops = new Map<string, LoopInfo>()
	/** The task tracker's participant id: the sender of runtime events that belong to no agent. */
	trackerId = ""
	taskSeq = 0

	constructor(
		readonly runId: string,
		readonly mock: boolean,
		limits: Partial<BudgetLimits> = {},
	) {
		super()
		this.budget = { ...DEFAULT_LIMITS, ...limits, tokensUsed: 0, costUsd: 0, startedAt: Date.now(), retries: 0 }
	}

	/**
	 * The first budget limit the run has passed, or null.
	 * `slack` moves every limit up by that share, e.g. 0.1 for limit × 1.1.
	 */
	budgetExceeded(slack = 0): string | null {
		const b = this.budget
		const k = 1 + slack
		if (b.tokensUsed >= b.maxTokens * k) return `tokens ${b.tokensUsed} >= ${Math.round(b.maxTokens * k)}`
		if (b.costUsd >= b.maxCostUsd * k) return `cost $${b.costUsd.toFixed(2)} >= $${(b.maxCostUsd * k).toFixed(2)}`
		if (Date.now() - b.startedAt >= b.maxWallMs * k) return `wall clock >= ${Math.round(b.maxWallMs * k)} ms`
		return null
	}
}
