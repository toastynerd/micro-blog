/** Format a YYYY-MM-DD date as e.g. "June 25, 2026" without timezone drift. */
export function formatDate(dateTaken: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateTaken);
  if (!m) return dateTaken;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
