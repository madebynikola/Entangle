/** Terminal output for the server: a short banner and one line per event, coloured only on a TTY. */

const tty = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text)

export const bold = paint(1)
export const dim = paint(2)
export const green = paint(32)
export const yellow = paint(33)
export const cyan = paint(36)

/** `  ➜  App      http://localhost:4317/` */
export function item(label: string, value: string): void {
	console.log(`  ${green("➜")}  ${bold(label.padEnd(8))} ${value}`)
}

export function note(text: string): void {
	console.log(`  ${dim(text)}`)
}
