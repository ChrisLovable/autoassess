// lib/disc.ts
// Lean schema — only the 6 essentials needed for a panel beater quote.

export type ParsedDisc = {
  make: string;            // UPPERCASE (TOYOTA, HYUNDAI...)
  model: string;           // Hilux 2.4 GD-6, Sedan, etc.
  year: string;            // YYYY — derived from VIN if not on disc
  vin: string;             // 17-char chassis number
  registrationNumber: string; // CA 487 654 / JKF904FS
  colour: string;          // Silver, White, Black...
  raw: string;             // Source identifier — [VISION] or [PDF417]
};

// ============================================================
// VIN Year Decoder (ISO 3779 standard)
// ============================================================

const VIN_YEAR_CODES: Record<string, [number, number]> = {
  A: [1980, 2010], B: [1981, 2011], C: [1982, 2012], D: [1983, 2013],
  E: [1984, 2014], F: [1985, 2015], G: [1986, 2016], H: [1987, 2017],
  J: [1988, 2018], K: [1989, 2019], L: [1990, 2020], M: [1991, 2021],
  N: [1992, 2022], P: [1993, 2023], R: [1994, 2024], S: [1995, 2025],
  T: [1996, 2026], V: [1997, 2027], W: [1998, 2028], X: [1999, 2029],
  Y: [2000, 2030],
  "1": [2001, 2031], "2": [2002, 2032], "3": [2003, 2033],
  "4": [2004, 2034], "5": [2005, 2035], "6": [2006, 2036],
  "7": [2007, 2037], "8": [2008, 2038], "9": [2009, 2039],
};

/**
 * Decode the model year from a VIN.
 * Position 10 = year code. Position 7 disambiguates between two 30-year cycles:
 *   - If position 7 is a LETTER → newer cycle (2010-2039)
 *   - If position 7 is a DIGIT  → older cycle (1980-2009)
 *
 * Returns the year as a string (e.g. "2006") or empty string if VIN invalid.
 */
export function vinToYear(vin: string): string {
  if (!vin || vin.length < 10) return "";
  const cleaned = vin.toUpperCase();
  const yearCode = cleaned[9];
  const positionSevenChar = cleaned[6];

  const codes = VIN_YEAR_CODES[yearCode];
  if (!codes) return "";

  // Disambiguate cycle: digit at position 7 → older, letter → newer
  const isOlderCycle = /[0-9]/.test(positionSevenChar);
  const year = isOlderCycle ? codes[0] : codes[1];
  return String(year);
}

/**
 * Decode country of manufacture from VIN's first 2 chars (WMI prefix).
 * Returns short country code or empty string.
 */
export function vinToCountry(vin: string): string {
  if (!vin || vin.length < 2) return "";
  const prefix = vin.substring(0, 2).toUpperCase();
  const ranges: [string, string, string][] = [
    ["AA", "AH", "South Africa"],
    ["JA", "JT", "Japan"],
    ["KL", "KR", "Korea"],
    ["LA", "L0", "China"],
    ["MA", "ME", "India"],
    ["SA", "SM", "United Kingdom"],
    ["TA", "TW", "Switzerland"],
    ["VA", "VE", "Austria"],
    ["VF", "VR", "France"],
    ["VS", "VW", "Spain"],
    ["WA", "W0", "Germany"],
    ["YA", "YE", "Belgium"],
    ["ZA", "ZR", "Italy"],
    ["1A", "10", "United States"],
    ["2A", "20", "Canada"],
    ["3A", "37", "Mexico"],
    ["9A", "9E", "Brazil"],
  ];
  for (const [start, end, name] of ranges) {
    if (prefix >= start && prefix <= end) return name;
  }
  return "";
}

/**
 * Try to parse SA disc text from PDF417 barcode decode.
 * Fast-path for when ZXing succeeds before falling back to Vision.
 * Returns null if input doesn't look like a SA disc.
 */
export function parseSADisc(rawText: string): ParsedDisc | null {
  if (!rawText || typeof rawText !== "string") return null;
  const trimmed = rawText.trim();
  if (!trimmed.includes("|")) return null;

  const fields = trimmed.split("|").map((f) => f.trim());
  if (fields.length < 12) return null;

  // Standard SA disc field order:
  //  [0] header, [1] tracking id, [2] license#, [3] reg#,
  //  [4] vehicle register#, [5] description, [6] make, [7] model,
  //  [8] VIN, [9] engine#, [10] colour, [11] expiry
  const vin = fields[8] || "";
  const result: ParsedDisc = {
    make: (fields[6] || "").toUpperCase(),
    model: fields[7] || "",
    year: vinToYear(vin), // Derive from VIN (disc rarely has year as a separate field)
    vin,
    registrationNumber: fields[3] || "",
    colour: fields[10] || "",
    raw: "[PDF417]",
  };

  if (!result.make && !result.registrationNumber && !result.vin) return null;

  return result;
}

/**
 * Mock data for development / fallback.
 */
export const MOCK_PARSED_DISC: ParsedDisc = {
  make: "TOYOTA",
  model: "HILUX 2.4 GD-6 RB RAIDER D/C",
  year: "2022",
  vin: "AHTBB3CD500123456",
  registrationNumber: "CA 487 654",
  colour: "Silver",
  raw: "[MOCK]",
};
