import { useEffect } from "react"
import { create } from "zustand"

export type ThemePref = "light" | "dark" | "system"

const KEY = "entangle.theme"
const media = () => window.matchMedia("(prefers-color-scheme: dark)")

function read(): ThemePref {
	try {
		const value = localStorage.getItem(KEY)
		return value === "light" || value === "dark" ? value : "system"
	} catch {
		return "system"
	}
}

function resolve(theme: ThemePref): "light" | "dark" {
	return theme === "system" ? (media().matches ? "dark" : "light") : theme
}

interface ThemeStore {
	theme: ThemePref
	resolved: "light" | "dark"
	setTheme(theme: ThemePref): void
	/** Light ↔ dark, leaving "system". */
	toggle(): void
}

export const useTheme = create<ThemeStore>()((set, get) => ({
	theme: read(),
	resolved: resolve(read()),
	setTheme(theme) {
		try {
			if (theme === "system") localStorage.removeItem(KEY)
			else localStorage.setItem(KEY, theme)
		} catch {
			// Storage blocked: the choice lasts until reload.
		}
		set({ theme, resolved: resolve(theme) })
	},
	toggle() {
		get().setTheme(get().resolved === "dark" ? "light" : "dark")
	},
}))

/** Keeps the `dark` class on <html> in step with the choice and, for "system", with the OS. */
export function ThemeSync() {
	const theme = useTheme((state) => state.theme)
	const resolved = useTheme((state) => state.resolved)
	useEffect(() => {
		document.documentElement.classList.toggle("dark", resolved === "dark")
	}, [resolved])
	useEffect(() => {
		if (theme !== "system") return
		const query = media()
		const onChange = () => useTheme.setState({ resolved: resolve("system") })
		query.addEventListener("change", onChange)
		return () => query.removeEventListener("change", onChange)
	}, [theme])
	return null
}
