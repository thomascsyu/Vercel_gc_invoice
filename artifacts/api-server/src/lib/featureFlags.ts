/** When false, staff proposal routes return 404; public client portal stays available. */
export function proposalsEnabled(): boolean {
  const raw = process.env["PROPOSALS_ENABLED"];
  if (raw === undefined || raw.trim() === "") return true;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
