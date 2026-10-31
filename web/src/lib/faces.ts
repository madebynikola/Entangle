import amity from "@design/agents/amity.svg?raw"
import ceres from "@design/agents/ceres.svg?raw"
import deneb from "@design/agents/deneb.svg?raw"
import fides from "@design/agents/fides.svg?raw"
import libra from "@design/agents/libra.svg?raw"
import spica from "@design/agents/spica.svg?raw"
import tinta from "@design/agents/tinta.svg?raw"
import tycho from "@design/agents/tycho.svg?raw"
import you from "@design/agents/you.svg?raw"

/**
 * The agent faces from the brand kit (design/agents, see design/HANDOFF.md). Each SVG holds every state;
 * `data-state` on the root picks one. Their CSS goes into the page once, so a face is only its markup.
 */

export type FaceId = "deneb" | "spica" | "libra" | "tycho" | "amity" | "tinta" | "fides" | "ceres" | "you"
/** `happy` is the smiling eyes without the done props: for greetings and the boot animation. */
export type FaceState = "idle" | "working" | "reject" | "done" | "happy"

export const FACE_NAME: Record<FaceId, string> = {
	deneb: "Deneb",
	spica: "Spica",
	libra: "Libra",
	tycho: "Tycho",
	amity: "Amity",
	tinta: "Tinta",
	fides: "Fides",
	ceres: "Ceres",
	you: "You",
}

const SOURCES: Record<FaceId, string> = { deneb, spica, libra, tycho, amity, tinta, fides, ceres, you }

/** The SVG's own markup without its <style>, as a fresh root the app sets the state on. */
const MARKUP = Object.fromEntries(
	Object.entries(SOURCES).map(([id, svg]) => {
		const body = svg.slice(svg.indexOf("</style>") + "</style>".length, svg.lastIndexOf("</svg>"))
		return [id, `<svg xmlns="http://www.w3.org/2000/svg" class="ag ag-${id}" data-state="idle" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`]
	}),
) as Record<FaceId, string>

export function faceMarkup(face: FaceId): string {
	return MARKUP[face]
}

/** Top-level blocks of a stylesheet: `selector{…}` or `@rule …{…}`, braces balanced. */
function blocks(css: string): string[] {
	const out: string[] = []
	let depth = 0
	let start = 0
	for (let i = 0; i < css.length; i++) {
		if (css[i] === "{") depth++
		else if (css[i] === "}" && --depth === 0) {
			out.push(css.slice(start, i + 1).trim())
			start = i + 1
		}
	}
	return out.filter(Boolean)
}

/**
 * Every face's CSS, once. Keyframes are shared across the files, so each name is kept once. The kit's
 * `prefers-color-scheme` block is dropped: the app's theme toggle sets `.dark`, which the kit also follows.
 */
function stylesheet(): string {
	const seen = new Set<string>()
	const kept: string[] = []
	for (const svg of Object.values(SOURCES)) {
		const css = svg.slice(svg.indexOf("<style>") + "<style>".length, svg.indexOf("</style>"))
		for (const block of blocks(css)) {
			if (block.startsWith("@media (prefers-color-scheme")) continue
			const keyframes = block.match(/^@keyframes\s+([\w-]+)/)
			if (keyframes) {
				if (seen.has(keyframes[1])) continue
				seen.add(keyframes[1])
			}
			kept.push(block)
		}
	}
	// Deneb's dark face (#48484A) is 2:1 on the dark panel; this grey is about 3.7:1.
	kept.push(".dark .ag-deneb .base{fill:#6e6e73}")
	return kept.join("\n")
}

if (typeof document !== "undefined" && !document.querySelector("style[data-faces]")) {
	const style = document.createElement("style")
	style.dataset.faces = ""
	style.textContent = stylesheet()
	document.head.append(style)
}
