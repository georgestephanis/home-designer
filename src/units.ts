// Feet-and-inches formatting and parsing. Lengths are stored in feet.

const FRACTIONS: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** 12.5 → 12′ 6″, rounded to the nearest quarter inch. */
export function fmtLen(ft: number): string {
  const sign = ft < 0 ? "-" : "";
  const quarters = Math.round(Math.abs(ft) * 48);
  const feet = Math.floor(quarters / 48);
  const inches = (quarters % 48) / 4;
  const whole = Math.floor(inches);
  const frac = FRACTIONS[inches - whole] ?? "";
  const inch = whole || frac ? `${whole || ""}${frac}″` : "";
  if (!feet) return `${sign}${inch || "0″"}`;
  return `${sign}${feet}′${inch ? ` ${inch}` : ""}`;
}

export function fmtArea(sqft: number): string {
  return `${Math.round(sqft).toLocaleString()} sq ft`;
}

/**
 * Parse a length into feet. Accepts 12'6", 12′ 6½″, 12 ft 6 in, 6", 150in, 3/4", 12' 6 1/2",
 * 1.5m, 40cm, and a bare number, which is feet. Returns null if it can't be read.
 */
export function parseLen(input: string): number | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  const metric = s.match(/^(-?\d*\.?\d+)\s*(m|cm|mm)$/);
  if (metric) return (parseFloat(metric[1]) * { m: 1, cm: 0.01, mm: 0.001 }[metric[2] as "m"]) / 0.3048;
  s = s
    .replace(/[′’‘`]/g, "'").replace(/[″”“]/g, '"').replace(/''/g, '"')
    .replace(/\s*(feet|foot|ft)\b/g, "'").replace(/\s*(inches|inch|in)\b/g, '"')
    .replace(/(\d)?\s*([¼½¾])/g, (_, d, f) => `${d ?? "0"} ${{ "¼": "1/4", "½": "1/2", "¾": "3/4" }[f as "½"]}`);
  const m = s.match(/^(-)?\s*(?:(\d*\.?\d+)\s*')?\s*(?:(\d*\.?\d+)?(?:\s*(\d+)\/(\d+))?\s*(")?)?\s*$/);
  if (!m) return null;
  const [, neg, ft, inch, num, den, inchMark] = m;
  if (ft == null && inch == null && num == null) return null;
  const frac = num != null ? parseInt(num) / parseInt(den) : 0;
  if (den != null && parseInt(den) === 0) return null;
  let total: number;
  if (ft == null && !inchMark && num == null) total = parseFloat(inch!); // bare number: feet
  else total = (ft ? parseFloat(ft) : 0) + ((inch ? parseFloat(inch) : 0) + frac) / 12;
  return neg ? -total : total;
}

export const SNAP_STEPS: { label: string; ft: number }[] = [
  { label: "1″", ft: 1 / 12 },
  { label: "3″", ft: 3 / 12 },
  { label: "6″", ft: 0.5 },
  { label: "1′", ft: 1 },
];
