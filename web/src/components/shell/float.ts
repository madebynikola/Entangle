import { createContext, useContext, useLayoutEffect, useState, type RefObject } from "react"

/**
 * A full-bleed screen (the Stage) runs under the run's header and replay bar, which float over it as cards.
 * The layout measures them and shares how much of the top and bottom they cover, so the screen can keep its
 * content in the open space between them.
 */
export interface FloatInsets {
	/** px from the panel's top to just below the floating header. */
	top: number
	/** px from the panel's bottom to just above the floating replay bar. */
	bottom: number
	/** px from the panel's left to the floating header's right edge: it is only as wide as its content. */
	headRight: number
}

export const FloatInsetsContext = createContext<FloatInsets>({ top: 0, bottom: 0, headRight: 0 })

export function useFloatInsets(): FloatInsets {
	return useContext(FloatInsetsContext)
}

/** The bottom edge of `top` and the top edge of `bottom`, measured against their container, kept in step on resize. */
export function useMeasureInsets(
	container: RefObject<HTMLElement | null>,
	top: RefObject<HTMLElement | null>,
	bottom: RefObject<HTMLElement | null>,
	enabled: boolean,
): FloatInsets {
	const [insets, setInsets] = useState<FloatInsets>({ top: 0, bottom: 0, headRight: 0 })
	useLayoutEffect(() => {
		if (!enabled) return
		const measure = () => {
			const box = container.current?.getBoundingClientRect()
			if (!box) return
			const head = top.current?.getBoundingClientRect()
			const foot = bottom.current?.getBoundingClientRect()
			const next = {
				top: head ? Math.round(head.bottom - box.top) : 0,
				bottom: foot ? Math.round(box.bottom - foot.top) : 0,
				headRight: head ? Math.round(head.right - box.left) : 0,
			}
			setInsets((prev) => (prev.top === next.top && prev.bottom === next.bottom && prev.headRight === next.headRight ? prev : next))
		}
		measure()
		const observer = new ResizeObserver(measure)
		for (const node of [container.current, top.current, bottom.current]) if (node) observer.observe(node)
		return () => observer.disconnect()
	}, [container, top, bottom, enabled])
	return insets
}
