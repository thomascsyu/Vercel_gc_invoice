import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

/**
 * PDFKit's built-in Helvetica uses WinAnsi and cannot draw Traditional Chinese
 * (those characters are encoded as missing glyphs and can corrupt the text
 * stream). Strings that need Unicode are drawn with Noto Sans TC. Latin-only
 * strings stay on Helvetica so existing layout measurements do not change.
 *
 * Fonts are Noto Sans TC (SIL Open Font License) at weights 400 and 700,
 * instantiated from the Google Fonts variable font. See fonts/OFL.txt.
 */

const CJK_REGULAR = "NotoSansTC";
const CJK_BOLD = "NotoSansTC-Bold";

/** Unicode scalars PDFKit maps onto WinAnsi bytes above U+00FF. */
const WIN_ANSI_EXTRA = new Set([
  338, 339, 352, 353, 376, 381, 382, 402, 710, 732, 8211, 8212, 8216, 8217, 8218,
  8220, 8221, 8222, 8224, 8225, 8226, 8230, 8240, 8249, 8250, 8364, 8482,
]);

type CjkDoc = PDFKit.PDFDocument & {
  __pdfFontKey?: string;
  __cjkFontsRegistered?: boolean;
};

let installed = false;
let regularPath: string | null = null;
let boldPath: string | null = null;

/** True when Helvetica/WinAnsi cannot encode this string. */
export function textNeedsUnicodeFont(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) continue;
    if (WIN_ANSI_EXTRA.has(cp)) continue;
    return true;
  }
  return false;
}

function resolveFont(file: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../fonts", file),
    path.resolve(here, "../fonts", file),
    path.resolve(process.cwd(), "fonts", file),
    path.resolve(process.cwd(), "artifacts/api-server/fonts", file),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Traditional Chinese font ${file} was not found. Looked in: ${candidates.join(", ")}`,
  );
}

function fontPaths(): { regular: string; bold: string } {
  if (!regularPath || !boldPath) {
    regularPath = resolveFont("NotoSansTC-Regular.ttf");
    boldPath = resolveFont("NotoSansTC-Bold.ttf");
  }
  return { regular: regularPath, bold: boldPath };
}

function activeFontKey(doc: CjkDoc): string {
  if (doc.__pdfFontKey) return doc.__pdfFontKey;
  const name = (doc as unknown as { _font?: { name?: string } })._font?.name;
  return name || "Helvetica";
}

function cjkFontKey(active: string): string {
  return /bold/i.test(active) ? CJK_BOLD : CJK_REGULAR;
}

function ensureCjkFonts(doc: CjkDoc): void {
  if (doc.__cjkFontsRegistered) return;
  const { regular, bold } = fontPaths();
  doc.registerFont(CJK_REGULAR, regular);
  doc.registerFont(CJK_BOLD, bold);
  doc.__cjkFontsRegistered = true;
}

function withUnicodeFont<T>(doc: CjkDoc, text: string, fn: () => T): T {
  if (!textNeedsUnicodeFont(text)) return fn();
  const active = activeFontKey(doc);
  const next = cjkFontKey(active);
  if (active === next) return fn();
  ensureCjkFonts(doc);
  doc.font(next);
  try {
    return fn();
  } finally {
    doc.font(active);
  }
}

/**
 * Teach every PDFDocument in this process to draw Traditional Chinese.
 * Latin-only text keeps the standard font the caller selected.
 */
export function installTraditionalChinesePdfSupport(): void {
  if (installed) return;
  installed = true;

  const proto = PDFDocument.prototype as CjkDoc;
  const originalFont = proto.font;
  const originalText = proto.text;
  const originalWidth = proto.widthOfString;
  const originalHeight = proto.heightOfString;

  proto.font = function (this: CjkDoc, src: string, family?: string | number, size?: number) {
    const result = originalFont.call(this, src, family as never, size as never);
    if (typeof src === "string") this.__pdfFontKey = src;
    return result;
  } as typeof proto.font;

  proto.text = function (this: CjkDoc, ...args: Parameters<PDFKit.PDFDocument["text"]>) {
    const raw = args[0];
    const text = raw == null ? "" : String(raw);
    return withUnicodeFont(this, text, () => originalText.apply(this, args));
  } as typeof proto.text;

  proto.widthOfString = function (this: CjkDoc, text: string, options?: PDFKit.Mixins.TextOptions) {
    const value = text == null ? "" : String(text);
    return withUnicodeFont(this, value, () => originalWidth.call(this, value, options));
  } as typeof proto.widthOfString;

  proto.heightOfString = function (this: CjkDoc, text: string, options?: PDFKit.Mixins.TextOptions) {
    const value = text == null ? "" : String(text);
    return withUnicodeFont(this, value, () => originalHeight.call(this, value, options));
  } as typeof proto.heightOfString;
}

installTraditionalChinesePdfSupport();
