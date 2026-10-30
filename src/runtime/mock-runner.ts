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

/** Returns the answer text for a request, or undefined to fall back to the default. */
export type MockResponder = (input: InferenceInput) => string | undefined

export interface MockOptions {
	/** Latency range in ms; each call waits a random time in it. */
	latencyMs?: [number, number]
	/** Agents can register canned answers here; the first one that answers wins. */
	responders?: MockResponder[]
	/** Share of calls (0..1) that fail like a provider under load (429 or 529), so the retries show with no keys. */
	errorRate?: number
}

/**
 * An InferenceRunner with fake latency and no API calls, so the whole pipeline runs with no keys.
 * Answers: a registered responder, else a value that fits `structuredOutput.schema`, else an echo.
 * Token counts are estimated as chars / 4.
 */
export class MockInferenceRunner implements InferenceRunner {
	private readonly latency: [number, number]
	private readonly errorRate: number
	readonly responders: MockResponder[]

	constructor(options: MockOptions = {}) {
		this.latency = options.latencyMs ?? [400, 1500]
		this.errorRate = options.errorRate ?? 0
		this.responders = options.responders ?? []
	}

	async run(input: InferenceInput): Promise<InferenceOutput> {
		const [min, max] = this.latency
		await new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)))
		if (Math.random() < this.errorRate) throw providerError()
		return this.answer(input)
	}

	async *stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
		const output = await this.run(input)
		const text = (output.items[0] as ModelMessageItem).content.text
		for (const chunk of text.match(/.{1,40}/gs) ?? []) {
			yield SemanticEvent.create("mock.delta", input.model, { text: chunk })
		}
		yield SemanticEvent.create("inference.output", input.model, output)
	}

	private answer(input: InferenceInput): InferenceOutput {
		let text: string | undefined
		for (const respond of this.responders) {
			text = respond(input)
			if (text !== undefined) break
		}
		if (text === undefined && input.structuredOutput) {
			text = JSON.stringify(fakeFromSchema(input.structuredOutput.schema))
		}
		text ??= `[mock ${input.model}] ${lastUserText(input).slice(0, 200)}`

		const inputTokens = Math.ceil(JSON.stringify(input.context.getItems()).length / 4)
		const outputTokens = Math.ceil(text.length / 4)
		return {
			items: [ModelMessageItem.rehydrate({ text })],
			tokenUsage: new TokenUsage(
				inputTokens,
				outputTokens,
				inputTokens + outputTokens,
				new InputTokenDetails(0),
				new OutputTokenDetails(0),
			),
			rowResponse: { mock: true },
		}
	}
}

/** Shaped like a provider SDK's API error: `status` and `headers`. */
function providerError(): Error {
	const status = Math.random() < 0.5 ? 429 : 529
	const message = status === 429 ? "mock: rate limit exceeded" : "mock: overloaded"
	return Object.assign(new Error(message), { status, headers: { "retry-after": "1" } })
}

export function lastUserText(input: InferenceInput): string {
	const items = input.context.getItems() as Array<{ type: string; role?: string; content?: { text?: string } }>
	const user = items.filter((item) => item.type === "message" && item.role === "user").at(-1)
	return user?.content?.text ?? ""
}

/** A minimal value that satisfies a JSON schema: first enum value, one array item, every property. */
export function fakeFromSchema(schema: Record<string, any>): unknown {
	if (schema.const !== undefined) return schema.const
	if (Array.isArray(schema.enum)) return schema.enum[0]
	const variants = schema.anyOf ?? schema.oneOf
	if (Array.isArray(variants)) return fakeFromSchema(variants[0])
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
	switch (type) {
		case "object":
			return Object.fromEntries(
				Object.entries((schema.properties ?? {}) as Record<string, any>).map(([key, value]) => [
					key,
					fakeFromSchema(value),
				]),
			)
		case "array":
			return schema.items ? [fakeFromSchema(schema.items)] : []
		case "string":
			return "mock"
		case "number":
			return 0.5
		case "integer":
			return 1
		case "boolean":
			return true
		default:
			return null
	}
}
