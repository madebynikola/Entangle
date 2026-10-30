import { useEffect, useRef } from "react"
import { faceMarkup, type FaceId } from "@/lib/faces"
import { cn } from "@/lib/utils"

/**
 * The boot animation from the brand kit (design/agents/boot.html, about 6.5 s): the logo's tiles pop in, each ink tile
 * wakes up as its agent, they look at the empty centre and smile in a wave, then shrink back into the still mark.
 * `loop` repeats it while something loads; once it turns false, the current pass ends on the logo (and the wordmark),
 * then `onDone` fires. With reduced motion it shows the last frame and finishes at once.
 */
export function BootMark({
	loop = false,
	word = true,
	onDone,
	className,
}: {
	loop?: boolean
	/** Fade in "Entangle" under the mark at the end. */
	word?: boolean
	onDone?: () => void
	className?: string
}) {
	const ref = useRef<HTMLDivElement>(null)
	const loopRef = useRef(loop)
	const doneRef = useRef(onDone)
	useEffect(() => {
		loopRef.current = loop
		doneRef.current = onDone
	})

	useEffect(() => {
		const root = ref.current
		if (!root) return
		let cancelled = false
		const wait = (ms: number) =>
			new Promise<void>((resolve, reject) => setTimeout(() => (cancelled ? reject(CANCELLED) : resolve()), ms))
		const slots = [...root.querySelectorAll<SVGGElement>(".slot")]
		const agents = slots.filter((slot) => slot.dataset.agent)
		const tile = (slot: Element) => slot.querySelector<SVGRectElement>(".tile")!
		const face = (slot: Element) => slot.querySelector<SVGGElement>(".face")!
		const state = (slot: Element, value: string) => slot.querySelector("svg.ag")?.setAttribute("data-state", value)
		const wordmark = root.querySelector<HTMLElement>(".boot-word")
		// The face's own CSS animations (blinks) keep running; only the timeline's are cancelled.
		const timeline = () => root.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSAnimation))

		// Each agent looks at the empty centre of the grid: its slot's direction to (50, 50), in face units.
		const lookAtCentre = (slot: SVGGElement, on: boolean) => {
			const gaze = slot.querySelector<SVGGElement>(".gaze")
			if (!gaze) return
			const dx = 50 - Number(slot.dataset.cx)
			const dy = 50 - Number(slot.dataset.cy)
			const length = Math.hypot(dx, dy)
			gaze.style.transform = on ? `translate(${((dx / length) * 5).toFixed(2)}px, ${((dy / length) * 4).toFixed(2)}px)` : ""
		}

		const reset = () => {
			timeline().forEach((a) => a.cancel())
			slots.forEach((slot) => (tile(slot).style.opacity = "0"))
			agents.forEach((slot) => {
				face(slot).style.opacity = "0"
				state(slot, "idle")
				lookAtCentre(slot, false)
			})
			if (wordmark) wordmark.style.opacity = "0"
		}

		const pass = async () => {
			reset()
			// 1. The logo builds: tiles pop in clockwise, the indigo tile among them.
			slots.forEach((slot, i) =>
				tile(slot).animate([{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], {
					duration: 650,
					delay: i * 90,
					easing: SOFT,
					fill: "forwards",
				}),
			)
			await wait(1150)

			// 2. Roll call: each ink tile wakes up as its agent.
			agents.forEach((slot, k) => {
				const delay = k * 150
				tile(slot).animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.45)", opacity: 0 }], {
					duration: 320,
					delay,
					easing: EASE,
					fill: "forwards",
				})
				face(slot).animate([{ transform: "scale(.3)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], {
					duration: 700,
					delay: delay + 60,
					easing: SOFT,
					fill: "forwards",
				})
			})
			await wait(agents.length * 150 + 750)

			// 3. They all look at the empty centre, then smile in a wave.
			agents.forEach((slot) => lookAtCentre(slot, true))
			await wait(700)
			for (const slot of agents) {
				state(slot, "happy")
				lookAtCentre(slot, false)
				await wait(80)
			}
			await wait(700)
			agents.forEach((slot) => state(slot, "idle"))
			await wait(250)

			// 4. They settle back into ink tiles: the still logo.
			agents.forEach((slot, k) => {
				const delay = k * 80
				face(slot).animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.35)", opacity: 0 }], {
					duration: 300,
					delay,
					easing: EASE,
					fill: "forwards",
				})
				tile(slot).animate([{ transform: "scale(.45)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], {
					duration: 600,
					delay: delay + 120,
					easing: SOFT,
					fill: "forwards",
				})
			})
			await wait(agents.length * 80 + 650)
		}

		const finish = () => {
			wordmark?.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
				duration: 500,
				easing: EASE,
				fill: "forwards",
			})
			doneRef.current?.()
		}

		if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
			reset()
			slots.forEach((slot) => (tile(slot).style.opacity = "1"))
			if (wordmark) wordmark.style.opacity = "1"
			doneRef.current?.()
		} else {
			void (async () => {
				try {
					await pass()
					while (loopRef.current) {
						await wait(500)
						await pass()
					}
					finish()
				} catch (error) {
					if (error !== CANCELLED) throw error
				}
			})()
		}
		return () => {
			cancelled = true
			timeline().forEach((a) => a.cancel())
		}
	}, [])

	return (
		<div ref={ref} className={cn("flex flex-col items-center gap-1.5", className)}>
			<svg viewBox="0 0 100 100" aria-hidden className="block w-full overflow-visible">
				{SLOTS.map(([agent, x, y]) => (
					<g key={`${x}-${y}`} className="slot" data-agent={agent ?? ""} data-cx={x + 9} data-cy={y + 9}>
						<rect
							className="tile"
							x={x}
							y={y}
							width="18"
							height="18"
							rx="4"
							fill={agent ? "var(--ink)" : "var(--link)"}
							opacity="0"
							style={ORIGIN}
						/>
						{agent && (
							<g className="face" opacity="0" style={ORIGIN}>
								{/* The same string on every render, so React leaves the face (and its blinks) alone. */}
								<svg
									x={x - 3}
									y={y - 3}
									width="24"
									height="24"
									overflow="visible"
									dangerouslySetInnerHTML={{ __html: faceMarkup(agent) }}
								/>
							</g>
						)}
					</g>
				))}
			</svg>
			{word && (
				<div className="boot-word text-[clamp(22px,4.5vw,36px)] font-semibold tracking-[-0.035em] text-ink" style={{ opacity: 0 }}>
					Entangle
				</div>
			)}
		</div>
	)
}

const CANCELLED = Symbol("cancelled")

/** Clockwise from the top left. The indigo tile (top right) stays the Entangle tile, so the grid settles into the exact mark. */
const SLOTS: [FaceId | null, number, number][] = [
	["deneb", 19, 19],
	["spica", 41, 19],
	[null, 63, 19],
	["tycho", 63, 41],
	["amity", 63, 63],
	["tinta", 41, 63],
	["fides", 19, 63],
	["you", 19, 41],
]

const ORIGIN = { transformBox: "fill-box", transformOrigin: "center" } as const

/** The kit's spring (damping 0.78): quick start, small overshoot, long rest. */
const SOFT =
	"linear(0,0.0296,0.1031,0.2017,0.3117,0.4231,0.5293,0.6261,0.7113,0.7841,0.8445,0.8934,0.9318,0.9612,0.983,0.9984,1.0088,1.0152,1.0186,1.0199,1.0196,1.0183,1.0165,1.0143,1.0121,1.01,1.008,1.0062,1.0047,1.0034,1.0024,1.0016,1)"
const EASE = "cubic-bezier(.45,0,.2,1)"
