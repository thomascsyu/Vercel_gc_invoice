/** First-letter initials of up to three words, always suffixed with 001. */
export function buildClientCode(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w.length > 0);
  const initials = words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
  return `${initials || "CLI"}001`;
}

/** Split a client code into its leading prefix and trailing number (GTL001 → GTL / 1). */
export function parseClientCode(code: string): { prefix: string; number: number; width: number } {
  const trimmed = code.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match?.[1] || !match[2]) {
    return { prefix: trimmed || "CLI", number: 0, width: 3 };
  }
  return { prefix: match[1], number: Number(match[2]), width: match[2].length };
}

export function formatClientCode(prefix: string, n: number, width: number): string {
  return `${prefix}${String(n).padStart(Math.max(width, 3), "0")}`;
}
