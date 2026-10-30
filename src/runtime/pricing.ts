/**
 * USD per million tokens. Anthropic first-party list prices, checked 30 Oct 2026.
 * Add other providers here when we use them; until then their cost is null.
 */
const PRICES: Record<string, { input: number; output: number }> = {
	"claude-haiku-4-5": { input: 1, output: 5 },
	"claude-sonnet-5-5": { input: 2, output: 10 },
	"claude-opus-5-5": { input: 4, output: 20 },
	"claude-fable-5-1": { input: 10, output: 50 },
}

export function costUsd(model: string | undefined, inputTokens: number, outputTokens: number): number | null {
	const price = model ? PRICES[model] : undefined
	if (!price) return null
	return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}
