import { useLayoutEffect, useRef } from "react"
import { faceMarkup, type FaceId, type FaceState } from "@/lib/faces"
import { ROLE_INFO, type RoleKey } from "@/lib/roles"
import { cn } from "@/lib/utils"

/**
 * An agent's face from the brand kit. It blinks and glances on its own; `state` switches what it does.
 * The markup is set once, and only `data-state` changes after that, so a state change never restarts the idle loop.
 * `gaze` turns the eyes towards a point: a unit vector, [1, 0] is right.
 */
export function AgentFace({
	face,
	state = "idle",
	gaze,
	label,
	className,
}: {
	face: FaceId
	state?: FaceState
	gaze?: [number, number] | null
	/** Read out by screen readers; without it the face is decoration. */
	label?: string
	className?: string
}) {
	const ref = useRef<HTMLSpanElement>(null)
	useLayoutEffect(() => {
		ref.current?.firstElementChild?.setAttribute("data-state", state)
	}, [face, state])
	useLayoutEffect(() => {
		const eyes = ref.current?.querySelector<SVGGElement>(".gaze")
		if (eyes) eyes.style.transform = gaze ? `translate(${gaze[0] * 4.5}px, ${gaze[1] * 3.5}px)` : ""
	}, [face, gaze?.[0], gaze?.[1]])
	return (
		<span
			ref={ref}
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			data-slot="agent-face"
			className={cn("inline-block size-6 shrink-0 [&>svg]:block [&>svg]:size-full [&>svg]:overflow-visible", className)}
			// The same string on every render, so React leaves the SVG (and its running animations) alone.
			dangerouslySetInnerHTML={{ __html: faceMarkup(face) }}
		/>
	)
}

/** A role's face, or its colour square for roles without one. */
export function RoleFace({ role, state, className }: { role: RoleKey; state?: FaceState; className?: string }) {
	const face = ROLE_INFO[role].face
	if (!face) return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-[3px] bg-role-other", className)} />
	return <AgentFace face={face} state={state} className={className} />
}
