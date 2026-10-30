import {
	OpenAIChatCompletions,
	SemanticEvent,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
} from "@mozaik-ai/core"
import { subqSettings, type SubqSettings } from "./config"

/**
 * An InferenceRunner on SubQ's OpenAI-compatible Chat Completions (docs.subq.ai): Mozaik's own
 * OpenAIChatCompletions endpoint, pointed at SubQ with SUBQ_API_KEY.
 *
 * Mozaik 4.1.0's chat mapper drops the call's structured output and max tokens, so this adds them, and
 * always sends a reasoning effort: SubQ has no bounded default, and its max_tokens covers reasoning.
 * It runs behind the ResilientRunner. The OpenAI SDK puts the HTTP status and headers on its errors,
 * so a 429 or 5xx is retried and a 402 (no credits) is not.
 */
export class SubqRunner implements InferenceRunner {
	private readonly endpoint: OpenAIChatCompletions

	constructor(private readonly settings: SubqSettings = subqSettings()) {
		// SubQ stores requests by default; these carry researcher and company data.
		this.endpoint = new OpenAIChatCompletions(undefined, {
			baseURL: settings.baseUrl,
			apiKey: settings.apiKey,
			extraBody: { store: false },
		})
		const chat = this.endpoint.endpointMapper
		this.endpoint.endpointMapper = {
			toRequest: (input: InferenceInput) => ({ ...chat.toRequest(input), ...extras(input, settings) }),
			toResponse: (response: unknown) => complete(chat.toResponse(response)),
		}
	}

	async run(input: InferenceInput): Promise<InferenceOutput> {
		if (!this.settings.apiKey) throw fail(401, "SUBQ_API_KEY is not set")
		return this.endpoint.infer({ ...input, streaming: false })
	}

	async *stream(input: InferenceInput): AsyncGenerator<SemanticEvent> {
		yield SemanticEvent.create("inference.output", input.model, await this.run(input))
	}
}

/** The request fields Mozaik's chat mapper leaves out. */
function extras(input: InferenceInput, settings: SubqSettings): Record<string, unknown> {
	const body: Record<string, unknown> = {
		max_tokens: input.maxOutputTokens,
		reasoning_effort: input.reasoningEffort ?? settings.reasoningEffort,
	}
	const format = input.structuredOutput
	if (format) {
		body.response_format = {
			type: "json_schema",
			json_schema: { name: format.name ?? "answer", schema: format.schema, strict: format.strict ?? true },
		}
	}
	return body
}

/** SubQ answers 200 to a reply cut at max_tokens. Its JSON is broken, and a retry would end the same way. */
function complete(output: InferenceOutput): InferenceOutput {
	const choice = output.rowResponse?.choices?.[0]
	if (choice?.finish_reason === "length") {
		throw new Error(`SubQ cut the answer at max_tokens (${output.tokenUsage?.outputTokens ?? "?"} output tokens)`)
	}
	return output
}

function fail(status: number, message: string): Error {
	return Object.assign(new Error(message), { status })
}
