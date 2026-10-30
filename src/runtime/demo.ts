import { createAgent } from "@mozaik-ai/core"
import type { Task } from "../types"
import { join } from "./mozaik"
import { createTask, runTask, whenSettled } from "./tasks"

const CLAIMS_SCHEMA = {
	name: "claims",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		required: ["claims"],
		properties: {
			claims: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["text", "sourceIds"],
					properties: { text: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
				},
			},
		},
	},
}

/**
 * Placeholder pipeline until the Orchestrator card (#14) replaces it:
 * three dummy agents share `companies` tasks, all started at once, so their loops overlap.
 */
export async function runDemo(companies: number, model: string): Promise<Task[]> {
	const agents = ["dummy-a", "dummy-b", "dummy-c"].map((name) =>
		createAgent({
			name,
			capabilities: ["inference"],
			instruction: "You are a placeholder agent. Answer in one short claim and cite the id you were given.",
			tools: [],
			handlers: [],
		}),
	)
	agents.forEach(join)

	const tasks = Array.from({ length: companies }, (_, i) => {
		const companyId = `C${String(i + 1).padStart(3, "0")}`
		const task = createTask("demo", agents[i % agents.length], companyId)
		runTask(task, `Write one claim about company ${companyId}, with sourceIds ["${companyId}"].`, {
			model,
			structuredOutput: CLAIMS_SCHEMA,
		})
		return task
	})
	return whenSettled(tasks.map((task) => task.id))
}
