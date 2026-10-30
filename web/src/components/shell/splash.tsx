import { AnimatePresence, motion } from "motion/react"
import { useEffect, useState } from "react"
import { BootMark } from "@/components/ui/boot"
import { useRunStore, useRunsStore } from "@/run/hooks"

const KEY = "entangle.booted"

/**
 * The first screen of a browser session: the boot animation over the whole window. It loops until the list of runs
 * (and a run opened by its link) has loaded, ends its pass on the logo, then fades out. A click or any key skips it.
 * Later page loads in the same session go straight to the app.
 */
export function SessionSplash() {
	const [show, setShow] = useState(() => !booted())
	const [ended, setEnded] = useState(false)
	const [timedOut, setTimedOut] = useState(false)
	const settled = useRunsStore((state) => state.runs !== null || state.error !== null)
	const runLoading = useRunStore((state) => state.loading)
	// A backend that never answers must not keep the app hidden: the screens show their own errors.
	const ready = (settled && !runLoading) || timedOut

	const dismiss = () => {
		try {
			sessionStorage.setItem(KEY, "1")
		} catch {}
		setShow(false)
	}

	useEffect(() => {
		if (!show) return
		const timer = setTimeout(() => setTimedOut(true), 12_000)
		const onKey = () => dismiss()
		window.addEventListener("keydown", onKey)
		return () => {
			clearTimeout(timer)
			window.removeEventListener("keydown", onKey)
		}
	}, [show])

	// Hold the finished mark and its name for a moment before the app shows.
	useEffect(() => {
		if (!ended || !ready) return
		const timer = setTimeout(dismiss, 900)
		return () => clearTimeout(timer)
	}, [ended, ready])

	return (
		<AnimatePresence>
			{show && (
				<motion.div
					key="splash"
					exit={{ opacity: 0 }}
					transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
					onClick={dismiss}
					role="status"
					aria-label="Loading Entangle"
					className="fixed inset-0 z-[100] grid cursor-default place-items-center bg-canvas"
				>
					<BootMark loop={!ready} onDone={() => setEnded(true)} className="w-[min(320px,64vw)]" />
				</motion.div>
			)}
		</AnimatePresence>
	)
}

function booted(): boolean {
	try {
		return sessionStorage.getItem(KEY) === "1"
	} catch {
		return false
	}
}
