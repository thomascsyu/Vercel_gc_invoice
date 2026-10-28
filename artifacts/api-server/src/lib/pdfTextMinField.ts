import { textNeedsUnicodeFont } from "./pdfTraditionalChinese";

/** Minimum printable length (padded with trailing spaces) for bill-to name & address rows on PDFs. */
export const PDF_MIN_BILL_TO_FIELD_CHARS = 40;

/** Minimum printable length (padded with trailing spaces) for bank detail PDF fields. */
export const PDF_MIN_ADDRESS_BANK_FIELD_CHARS = 50;

/**
 * Pad string so it has at least `min` characters (spaces), for PDF field width.
 * Traditional Chinese (and any other non-WinAnsi text) is not padded: those
 * glyphs are already full-width, and trailing spaces wrap inside narrow bank
 * columns and push the rest of the document onto extra pages.
 */
export function padMinFieldLength(value: string, minChars: number): string {
  if (textNeedsUnicodeFont(value)) return value;
  if (value.length >= minChars) return value;
  return `${value}${" ".repeat(minChars - value.length)}`;
}
