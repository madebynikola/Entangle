const CYRILLIC: Record<string, string> = {
	а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj",
	м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c",
	џ: "dz", ш: "s",
}

/** Lowercase, Serbian Cyrillic to Latin, no diacritics: `Марковић` and `Markovic` both become `markovic`. */
export function fold(text: string): string {
	return text
		.toLowerCase()
		.replace(/[Ѐ-ӿ]/g, (ch) => CYRILLIC[ch] ?? ch)
		.replace(/đ/g, "dj")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
}

const LEGAL_FORMS = new Set(["doo", "ad", "llc", "ltd", "gmbh", "inc"])

function nameTokens(name: string): string[] {
	return fold(name)
		.replace(/\./g, "")
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 1 && !LEGAL_FORMS.has(token))
}

/**
 * Whether a name fits the dataset name of an id. Word order and the legal form do not count,
 * so `Jeremić Mirjana` fits `Mirjana Jeremić` and `ArmaturaSec` fits `ArmaturaSec d.o.o.`.
 */
export function sameName(a: string, b: string): boolean {
	const x = nameTokens(a)
	const y = nameTokens(b)
	if (!x.length || !y.length) return false
	return x.every((token) => y.includes(token)) || y.every((token) => x.includes(token))
}

/** Ids written in free text: R0001, C001, C001-CH1, SYN-PUB-00001, SYN-PRJ-0001, SYN-PAT-001, and OpenAlex works (W4293154696). */
export function idsIn(text: string): string[] {
	return [...new Set(text.match(/\b(?:R\d{4}|C\d{3}(?:-CH\d+)?|SYN-(?:PUB|PRJ|PAT)-\d+|W\d{6,})\b/g) ?? [])]
}

export function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text
}
