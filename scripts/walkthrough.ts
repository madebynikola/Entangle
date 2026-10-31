/**
 * Builds the team's reading script, docs/walkthrough.md, into a PDF.
 *
 *   npm run walkthrough                      docs/entangle-walkthrough.pdf
 *   npm run walkthrough -- --out PATH        write the PDF elsewhere
 *
 * The Markdown is the source: edit it, run this, commit both. It uses what the repo already has: react-markdown for
 * the HTML, the brand's Inter and Source Serif 4 from node_modules, and Chromium from Playwright to print it
 * (`npx playwright install chromium` the first time on a machine). No key, no network.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { chromium } from "playwright"

const ROOT = resolve(import.meta.dirname, "..")
const SOURCE = join(ROOT, "docs/walkthrough.md")

const { values } = parseArgs({ options: { out: { type: "string" } } })
const out = resolve(values.out ?? join(ROOT, "docs/entangle-walkthrough.pdf"))

/** A woff2 from the brand fonts, as a file URL the printed page can load. */
const font = (family: string, file: string) => pathToFileURL(join(ROOT, "node_modules/@fontsource-variable", family, "files", file)).href

/** Latin first, then Latin Extended, which holds č ć š ž đ: the Serbian names in the examples. */
const FACES = [
	["Inter", "inter", "inter-latin-wght-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
	["Inter", "inter", "inter-latin-ext-wght-normal.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"],
	["Source Serif 4", "source-serif-4", "source-serif-4-latin-wght-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"],
	["Source Serif 4", "source-serif-4", "source-serif-4-latin-ext-wght-normal.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"],
]
	.map(([family, dir, file, range]) => `@font-face { font-family: "${family}"; font-weight: 100 900; font-style: normal; src: url("${font(dir, file)}") format("woff2"); unicode-range: ${range}; }`)
	.join("\n")

/** Calm and quiet, like the app: ink on white, one indigo for ids and links, hairlines instead of boxes. No monospace, as in the brand kit. */
const CSS = `
${FACES}
:root { --ink: #1D1D1F; --muted: #5b5b63; --subtle: #8a8a93; --hairline: #e4e4e8; --sunken: #f5f5f7; --indigo: #3E4BB8; --indigo-50: #EEF0FC; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); background: #fff; font: 9.6pt/1.55 "Inter", system-ui, sans-serif; font-feature-settings: "cv11", "ss03"; font-variant-numeric: tabular-nums; }
h1, h2, h3 { font-family: "Source Serif 4", Georgia, serif; font-weight: 600; letter-spacing: -0.01em; color: var(--ink); break-after: avoid; }
h1 { font-size: 21pt; line-height: 1.15; margin: 30pt 0 12pt; padding-top: 14pt; border-top: 0.75pt solid var(--hairline); }
h1:first-of-type { font-size: 30pt; margin: 0 0 10pt; padding-top: 0; border-top: 0; }
h1:nth-of-type(2) { margin-top: 18pt; border-top: 0; padding-top: 0; }
h2 { font-size: 13.5pt; margin: 20pt 0 6pt; }
h3 { font-size: 11pt; margin: 14pt 0 4pt; }
p { margin: 0 0 7pt; orphans: 3; widows: 3; }
strong { font-weight: 620; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin: 0 0 3pt; }
hr { display: none; }
a { color: var(--indigo); text-decoration: none; }
blockquote { margin: 10pt 0 12pt; padding: 8pt 12pt; background: var(--indigo-50); border-left: 2.5pt solid var(--indigo); border-radius: 0 4pt 4pt 0; font-family: "Source Serif 4", Georgia, serif; font-size: 10.4pt; line-height: 1.55; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }
code { font: inherit; font-size: 0.92em; font-weight: 520; color: var(--indigo); background: var(--sunken); border-radius: 3pt; padding: 0.5pt 3pt; white-space: break-spaces; overflow-wrap: anywhere; }
pre { margin: 6pt 0 10pt; padding: 8pt 10pt; background: var(--sunken); border-radius: 5pt; break-inside: avoid; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
pre code { background: none; padding: 0; color: var(--ink); font-weight: 460; font-size: 8.8pt; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; font-size: 8.4pt; line-height: 1.42; }
thead th { text-align: left; font-weight: 600; color: var(--muted); font-size: 7.6pt; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1pt solid var(--ink); padding: 4pt 6pt 4pt 0; }
tbody td { vertical-align: top; border-bottom: 0.5pt solid var(--hairline); padding: 4pt 6pt 4pt 0; }
tbody tr { break-inside: avoid; }
tbody td code { font-size: 0.95em; }
`

const body = renderToStaticMarkup(
	createElement(Markdown, {
		remarkPlugins: [remarkGfm],
		// A link to another file of the repo means nothing on paper: keep the words, drop the link.
		components: { a: ({ href, children }) => (href?.startsWith("http") ? createElement("a", { href }, children) : createElement("span", null, children)) },
		children: readFileSync(SOURCE, "utf8"),
	}),
)

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Entangle, explained</title><style>${CSS}</style></head><body>${body}</body></html>`

const work = mkdtempSync(join(tmpdir(), "entangle-walkthrough-"))
try {
	const page = join(work, "walkthrough.html")
	writeFileSync(page, html)
	mkdirSync(dirname(out), { recursive: true })
	const browser = await chromium.launch()
	try {
		const tab = await browser.newPage()
		await tab.goto(pathToFileURL(page).href)
		await tab.evaluate(() => document.fonts.ready)
		await tab.pdf({
			path: out,
			format: "A4",
			printBackground: true,
			margin: { top: "20mm", bottom: "20mm", left: "19mm", right: "19mm" },
			displayHeaderFooter: true,
			headerTemplate: "<span></span>",
			footerTemplate: `<div style="width:100%;padding:0 19mm;font:7.5pt Helvetica,Arial,sans-serif;color:#8a8a93;display:flex;justify-content:space-between"><span>Entangle, explained · reading script</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
		})
	} finally {
		await browser.close()
	}
} finally {
	rmSync(work, { recursive: true, force: true })
}
console.log(`wrote ${out}`)
