/**
 * USD per million tokens, for every model in config/models.ts and a few more.
 * Anthropic: first-party list prices, checked 30 Oct 2026.
 * OpenAI and Google: from price aggregators on 30 Oct 2026 (not the providers' own pages); Gemini Pro at ≤200k context.
 * A model missing here has cost null: it adds tokens to the budget, but no cost.
 */
const PRICES: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5": { input: 1, output: 5 },
	"claude-sonnet-4-6": { input: 3, output: 15 },
	"claude-sonnet-5-5": { input: 2, output: 10 },
	"claude-opus-5-5": { input: 4, output: 20 },
	"claude-fable-5-1": { input: 10, output: 50 },
	"gpt-5.4-mini": { input: 0.75, output: 4.5 },
	"gpt-5.5": { input: 5, output: 30 },
	"gemini-3.5-flash": { input: 1.5, output: 9 },
	"gemini-3.1-pro-preview": { input: 2, output: 12 },
}

export function costUsd(model: string | undefined, inputTokens: number, outputTokens: number): number | null {
	const price = model ? PRICES[model] : undefined
	if (!price) return null
	return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}
