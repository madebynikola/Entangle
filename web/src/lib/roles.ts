import type { AgentRole } from "@shared/types"
import type { FaceId } from "./faces"

export const ROLES: AgentRole[] = ["orchestrator", "analyst", "profiler", "matchmaker", "writer", "critic"]

export type RoleKey = AgentRole | "other"

/**
 * Plain names, one line on what each role does, and the role's character from the brand kit (design/HANDOFF.md):
 * its name and face. Every agent of a role shares the face, so six profilers are six Tychos.
 */
export const ROLE_INFO: Record<RoleKey, { label: string; plural: string; job: string; name: string; face: FaceId | null }> = {
	orchestrator: { label: "Orchestrator", plural: "Orchestrator", job: "Hands out work and assembles the result", name: "Deneb", face: "deneb" },
	analyst: { label: "Industry Analyst", plural: "Analysts", job: "Reads a company and writes its needs", name: "Spica", face: "spica" },
	profiler: { label: "Research Profiler", plural: "Profilers", job: "Reads a researcher's work and writes a profile", name: "Tycho", face: "tycho" },
	matchmaker: { label: "Matchmaker", plural: "Matchmaker", job: "Pairs researchers with company challenges", name: "Amity", face: "amity" },
	writer: { label: "Proposal Writer", plural: "Writers", job: "Writes a PhD topic or joint project for a pair", name: "Tinta", face: "tinta" },
	critic: { label: "Critic", plural: "Critic", job: "Checks every claim against its sources", name: "Fides", face: "fides" },
	other: { label: "Agent", plural: "Other agents", job: "", name: "", face: null },
}

/** Tailwind classes per role. Literal strings, so Tailwind finds them. */
export const ROLE_CLASS: Record<RoleKey, { bg: string; text: string; border: string; soft: string }> = {
	orchestrator: { bg: "bg-role-orchestrator", text: "text-role-orchestrator", border: "border-role-orchestrator", soft: "bg-role-orchestrator/12" },
	analyst: { bg: "bg-role-analyst", text: "text-role-analyst", border: "border-role-analyst", soft: "bg-role-analyst/12" },
	profiler: { bg: "bg-role-profiler", text: "text-role-profiler", border: "border-role-profiler", soft: "bg-role-profiler/12" },
	matchmaker: { bg: "bg-role-matchmaker", text: "text-role-matchmaker", border: "border-role-matchmaker", soft: "bg-role-matchmaker/12" },
	writer: { bg: "bg-role-writer", text: "text-role-writer", border: "border-role-writer", soft: "bg-role-writer/12" },
	critic: { bg: "bg-role-critic", text: "text-role-critic", border: "border-role-critic", soft: "bg-role-critic/12" },
	other: { bg: "bg-role-other", text: "text-role-other", border: "border-role-other", soft: "bg-role-other/12" },
}

/** CSS colour for a role, for SVG and canvas: `var(--role-critic)`. */
export function roleColor(role: RoleKey): string {
	return `var(--role-${role})`
}

/** The role from a participant name: `profiler-2` → profiler. Unknown names → other. */
export function roleOf(name: string | undefined): RoleKey {
	const prefix = name?.toLowerCase().split(/[-_\s:]/)[0]
	return (ROLES as string[]).includes(prefix ?? "") ? (prefix as AgentRole) : "other"
}
