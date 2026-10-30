import {
	InputTokenDetails,
	ModelMessageItem,
	OutputTokenDetails,
	SemanticEvent,
	TokenUsage,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
} from "@mozaik-ai/core"
import { decisionEndpoint, subqSettings } from "./config"

/** A typed question for a decision model (docs.subq.ai, Decisions API). */
export type DecisionQuestion =
	/** Yes or no: the answer is the probability of yes. */
	| { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
	/** One of 2–255 options, each with an optional description. */
	| { type: "choice"; instructions: string; criteria: Record<string, string | null> }
	/** 2–10 ordered levels: the answer is a probability-weighted level. */
	| { type: "score"; instructions: string; criteria: Record<string, string> }

export interface DecisionAnswer {
	type: DecisionQuestion["type"]
	noul?: number
	choice?: string
	score?: number
	confidence?: number
	probabilities?: Record<string, number>
}

/** A call put as typed questions: what to ask, and how the answers become the call's answer text. */
export interface Decision {
	/** What the questions are about: text, an object or an array. */
	state: unknown
	/** 1–128 questions by name, each judged on its own against the same state. */
	questions: Record<string, DecisionQuestion>
	/** The answer text, e.g. the JSON of the call's structured output, from the answers by question name. */
	answer(answers: Record<string, DecisionAnswer>): string
}

/** Puts a call to a decision model as typed questions, or returns undefined when the call is not its agent's. */
export type Decider = (input: InferenceInput) => Decision | undefined

/**
 * An InferenceRunner for decision models (subq-snap on SubQ, Jev on typesafe.ai): `POST /systemone` with typed
 * questions instead of a prompt. They write no text, so an agent that sends them a call registers a Decider that
 * puts the call as questions and turns the answers back into its answer. Every other call goes to `inner`.
 *
 * It runs behind the ResilientRunner: errors carry the HTTP status and headers, so a 429 or 5xx is retried and
 * a 402 (no credits) is not. Only input tokens are billed; output tokens are always 0.
 */
export class SnapRunner implements InferenceRunner {
	readonly deciders: Decider[] = []

	constructor(
		/** The runner for every other model. Agents reach a mock's `responders` through it. */
		readonly inner: InferenceRunner,
	) {}

	async run(input: InferenceInput): Promise<InferenceOutput> {
		const endpoint = decisionEndpoint(input.model)
		if (!endpoint) return this.inner.run(input)
		const decision = this.decide(input)
		if (!endpoint.apiKey) throw fail(401, `${endpoint.keyVar} is not set, for ${input.model}`)

		const response = await fetch(`${endpoint.baseUrl}/systemone`, {
			method: "POST",
			headers: { authorization: `Bearer ${endpoint.apiKey}`, "content-type": "application/json" },
			body: JSON.stringify({ model: input.model, state: decision.state, questions: decision.questions }),
			signal: AbortSignal.timeout(subqSettings().timeoutMs),
		})
		const body = (await response.json().catch(() => undefined)) as DecisionResponse | undefined
		if (!response.ok) {
			const detail = body?.detail
			const message = typeof detail === "string" ? detail : (detail?.message ?? response.statusText)
			throw Object.assign(new Error(`${response.status} ${message}`), { status: response.status, headers: response.headers })
		}
		if (!body?.answers) throw fail(502, `${input.model} gave no answers`)

		const inputTokens = body.usage?.input_tokens ?? 0
		return {
			items: [ModelMessageItem.rehydrate({ text: decision.answer(body.answers) })],
			tokenUsage: new TokenUsage(inputTokens, 0, inputTokens, new InputTokenDetails(0), new OutputTokenDetails(0)),
			rowResponse: body,
		}
	}

	async *stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
		if (!decisionEndpoint(input.model)) {
			yield* this.inner.stream(input)
			return
		}
		yield SemanticEvent.create("inference.output", input.model, await this.run(input))
	}

	private decide(input: InferenceInput): Decision {
		for (const decide of this.deciders) {
			const decision = decide(input)
			if (decision) return decision
		}
		throw fail(400, `${input.model} answers typed questions only, and no agent put this call as questions`)
	}
}

interface DecisionResponse {
	model?: string
	answers?: Record<string, DecisionAnswer>
	usage?: { input_tokens?: number; output_tokens?: number }
	detail?: string | { error_type?: string; message?: string }
}

function fail(status: number, message: string): Error {
	return Object.assign(new Error(message), { status })
}
