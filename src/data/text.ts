/**
 * Text analysis shared by normalisation and search: Cyrillic → Latin, diacritics, tokens, stems.
 * The same analyzer runs on documents and queries, so `Марковић` and `Markovic` match.
 */

const CYRILLIC: Record<string, string> = {}
{
	const from = "абвгдђежзијклљмнњопрстћуфхцчџшАБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ"
	const to = [
		"a", "b", "v", "g", "d", "đ", "e", "ž", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t",
		"ć", "u", "f", "h", "c", "č", "dž", "š",
		"A", "B", "V", "G", "D", "Đ", "E", "Ž", "Z", "I", "J", "K", "L", "Lj", "M", "N", "Nj", "O", "P", "R", "S", "T",
		"Ć", "U", "F", "H", "C", "Č", "Dž", "Š",
	]
	;[...from].forEach((ch, i) => (CYRILLIC[ch] = to[i]))
}

/** Serbian Cyrillic → Serbian Latin, keeping diacritics: `Јелена Марковић` → `Jelena Marković`. */
export function toLatin(s: string): string {
	return s.replace(/[Ѐ-ӿ]/g, (ch) => CYRILLIC[ch] ?? ch)
}

/** Latin, no diacritics, `đ` → `dj`, lowercase, single spaces. The key for label maps and name checks. */
export function fold(s: string): string {
	return toLatin(s)
		.replace(/đ/g, "dj")
		.replace(/Đ/g, "Dj")
		.normalize("NFKD")
		.replace(/[̀-ͯ­]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu

/** Company pages hold personal addresses. Agents never see them (docs/dataset.md, "Contact data"). */
export function maskEmails(s: string): string {
	return s.replace(EMAIL, "[email removed]")
}

// prettier-ignore
const STOPWORDS = new Set([
	"a", "about", "above", "after", "again", "against", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be",
	"because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "could", "did", "do", "does",
	"doing", "down", "during", "each", "etc", "few", "for", "from", "further", "had", "has", "have", "having", "he", "her",
	"here", "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "may", "me", "more",
	"most", "must", "my", "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "out",
	"over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "then",
	"there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "us", "very", "via", "was",
	"we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with", "within", "without",
	"would", "you", "your", "yours",
	// Generic in this corpus: every abstract and challenge says them.
	"based", "using", "use", "used", "new", "need", "needs", "want", "approach", "study", "paper", "results", "show",
	// Common Serbian function words.
	"i", "u", "na", "za", "od", "do", "se", "je", "su", "da", "sa", "koji", "koja", "koje", "kao", "iz", "ili", "po", "ne",
	"pri", "kroz", "nije", "smo", "su", "biti", "ova", "ovaj", "ovo", "nas", "naš", "nasa", "nase", "naše",
])

const stemCache = new Map<string, string>()

/** Lowercase, fold, split, drop stopwords, stem. */
export function analyze(s: string): string[] {
	const out: string[] = []
	for (const token of fold(s).split(/[^a-z0-9]+/)) {
		if (token.length < 2 || STOPWORDS.has(token)) continue
		let stem = stemCache.get(token)
		if (stem === undefined) {
			stem = /^\d+$/.test(token) ? token : porter(token)
			stemCache.set(token, stem)
		}
		out.push(stem)
	}
	return out
}

// ---------------------------------------------------------------------------
// Porter stemmer (1980). English only; Serbian words pass through mostly unchanged.
// ---------------------------------------------------------------------------

function isConsonant(w: string, i: number): boolean {
	const c = w[i]
	if ("aeiou".includes(c)) return false
	if (c === "y") return i === 0 || !isConsonant(w, i - 1)
	return true
}

/** m in [C](VC)^m[V] for w[0..end). */
function measure(w: string, end: number): number {
	let m = 0
	let i = 0
	while (i < end && isConsonant(w, i)) i++
	while (i < end) {
		while (i < end && !isConsonant(w, i)) i++
		if (i >= end) break
		while (i < end && isConsonant(w, i)) i++
		m++
	}
	return m
}

function hasVowel(w: string, end: number): boolean {
	for (let i = 0; i < end; i++) if (!isConsonant(w, i)) return true
	return false
}

function endsDouble(w: string): boolean {
	const n = w.length
	return n >= 2 && w[n - 1] === w[n - 2] && isConsonant(w, n - 1)
}

/** cvc at the end, where the last c is not w, x or y. */
function endsCvc(w: string): boolean {
	const n = w.length
	if (n < 3) return false
	return isConsonant(w, n - 3) && !isConsonant(w, n - 2) && isConsonant(w, n - 1) && !"wxy".includes(w[n - 1])
}

type Rule = [suffix: string, replacement: string]

const byLength = (rules: Rule[]) => rules.sort((a, b) => b[0].length - a[0].length)

const STEP2 = byLength([
	["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"], ["izer", "ize"], ["bli", "ble"],
	["alli", "al"], ["entli", "ent"], ["eli", "e"], ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"],
	["ator", "ate"], ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"], ["aliti", "al"],
	["iviti", "ive"], ["biliti", "ble"], ["logi", "log"],
])
const STEP3 = byLength([
	["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"], ["ful", ""], ["ness", ""],
])
const STEP4 = byLength(
	["al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent", "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize"].map(
		(s): Rule => [s, ""],
	),
)

/** Replace the longest matching suffix if the stem before it has measure > min. Stops at the first match. */
function applyRules(w: string, rules: Rule[], min: number): string {
	for (const [suffix, replacement] of rules) {
		if (!w.endsWith(suffix)) continue
		const stem = w.length - suffix.length
		if (suffix === "ion" && !/[st]$/.test(w.slice(0, stem))) return w
		return measure(w, stem) > min ? w.slice(0, stem) + replacement : w
	}
	return w
}

export function porter(word: string): string {
	let w = word
	if (w.length <= 2) return w

	// Step 1a
	if (w.endsWith("sses")) w = w.slice(0, -2)
	else if (w.endsWith("ies")) w = w.slice(0, -2)
	else if (!w.endsWith("ss") && w.endsWith("s")) w = w.slice(0, -1)

	// Step 1b
	if (w.endsWith("eed")) {
		if (measure(w, w.length - 3) > 0) w = w.slice(0, -1)
	} else {
		const suffix = w.endsWith("ed") ? "ed" : w.endsWith("ing") ? "ing" : ""
		if (suffix && hasVowel(w, w.length - suffix.length)) {
			w = w.slice(0, -suffix.length)
			if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w += "e"
			else if (endsDouble(w) && !/[lsz]$/.test(w)) w = w.slice(0, -1)
			else if (measure(w, w.length) === 1 && endsCvc(w)) w += "e"
		}
	}

	// Step 1c
	if (w.endsWith("y") && hasVowel(w, w.length - 1)) w = w.slice(0, -1) + "i"

	w = applyRules(w, STEP2, 0)
	w = applyRules(w, STEP3, 0)
	w = applyRules(w, STEP4, 1)

	// Step 5a
	if (w.endsWith("e")) {
		const m = measure(w, w.length - 1)
		if (m > 1 || (m === 1 && !endsCvc(w.slice(0, -1)))) w = w.slice(0, -1)
	}
	// Step 5b
	if (w.endsWith("ll") && measure(w, w.length) > 1) w = w.slice(0, -1)
	return w
}
