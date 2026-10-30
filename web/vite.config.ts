import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The server (src/server/main.ts) runs this config in middleware mode for `npm run dev` and `npm run replay`.
export default defineConfig({
	root: here("."),
	base: "./",
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": here("./src"),
			"@shared": here("../src"),
		},
	},
	build: {
		outDir: here("./dist"),
		emptyOutDir: true,
		// React, Router, Radix and Motion in one vendor-heavy entry; the screens load lazily.
		chunkSizeWarningLimit: 1000,
	},
})
