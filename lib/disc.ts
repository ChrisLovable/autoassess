// lib/disc.ts
// SA disc parser + VIN decoders + body type normalizer.
// ZERO HALLUCINATION: empty when unknown, never invent.

export type ParsedDisc = {
  make: string;
  model: string;
  year: string;
  vin: string;
  registrationNumber: string;
  colour: string;
  bodyType: string;
  raw: string;
};

// ============================================================
// SA Body Type normalizer
// ============================================================
// Maps NHTSA / SA disc body class values to clean SA-friendly terms.
// Returns the original string title-cased if no match found.

const SA_BODY_TYPES: Record<string, string> = {
  // Sedans
  "sedan/saloon": "Sedan",
  "sedan": "Sedan",
  "saloon": "Sedan",
  "sedan (closed top)": "Sedan",
  "sedan (open top)": "Sedan (Open Top)",

  // Hatchbacks
  "hatchback/liftback/notchback": "Hatchback",
  "hatchback": "Hatchback",
  "hatch back": "Hatchback",
  "hatchback (3 door)": "Hatchback",
  "hatchback (5 door)": "Hatchback",
  "liftback": "Hatchback",
  "notchback": "Hatchback",
  "5-door hatchback": "Hatchback",
  "3-door hatchback": "Hatchback",

  // SUVs / MPVs
  "sport utility vehicle (suv)/multi-purpose vehicle (mpv)": "SUV",
  "sport utility vehicle (suv)": "SUV",
  "sport utility vehicle": "SUV",
  "sports utility vehicle": "SUV",
  "suv": "SUV",
  "multi-purpose vehicle (mpv)": "MPV",
  "multi-purpose vehicle": "MPV",
  "mpv": "MPV",
  "crossover": "SUV",

  // Bakkies (SA term for pickup)
  "pickup": "Bakkie",
  "pickup truck": "Bakkie",
  "light delivery vehicle": "Bakkie",
  "light delivery vehicle (single cab)": "Bakkie (Single Cab)",
  "light delivery vehicle (double cab)": "Bakkie (Double Cab)",
  "single cab": "Bakkie (Single Cab)",
  "double cab": "Bakkie (Double Cab)",
  "extra cab": "Bakkie (Extra Cab)",
  "club cab": "Bakkie (Extra Cab)",
  "crew cab": "Bakkie (Double Cab)",

  // Coupes
  "coupe": "Coupe",
  "coupé": "Coupe",
  "2 door coupe": "Coupe",

  // Convertibles
  "convertible/cabriolet": "Convertible",
  "convertible": "Convertible",
  "cabriolet": "Convertible",
  "roadster": "Convertible",

  // Vans
  "van": "Van",
  "minivan": "Van",
  "panel van": "Panel Van",
  "cargo van": "Panel Van",
  "passenger van": "Van",

  // Wagons
  "wagon": "Wagon",
  "station wagon": "Wagon",
  "estate": "Wagon",
  "estate wagon": "Wagon",

  // Buses
  "mini bus": "Mini Bus",
  "minibus": "Mini Bus",
  "bus": "Bus",

  // Motorcycles (just in case)
  "motorcycle": "Motorcycle",
  "scooter": "Scooter",
};

/**
 * Normalize a body type string (from NHTSA or SA disc) to a clean SA term.
 * Returns empty string if input is empty/unknown.
 * Returns input title-cased if no exact mapping but input has content.
 */
export function normalizeBodyType(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.toLowerCase().trim();

  // Skip NHTSA "Not Applicable" type values
  if (/^not applicable$/i.test(cleaned)) return "";
  if (/^n\/?a$/i.test(cleaned)) return "";
  if (/^unknown$/i.test(cleaned)) return "";

  // Exact match
  if (SA_BODY_TYPES[cleaned]) return SA_BODY_TYPES[cleaned];

  // Partial match — find first SA body type whose key appears in the input
  for (const [key, value] of Object.entries(SA_BODY_TYPES)) {
    if (key.length >= 4 && cleaned.includes(key)) return value;
  }

  // No mapping — return title-cased version of input
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

// ============================================================
// VIN Decoders (programmatic, deterministic)
// ============================================================

const WMI_TO_MAKE: Record<string, string> = {
  // South Africa
  AAV: "VOLKSWAGEN", AFA: "FORD",
  AHT: "TOYOTA", AHH: "TOYOTA",
  ADM: "GENERAL MOTORS", ADD: "MERCEDES-BENZ",
  MAJ: "FORD", MAK: "MAHINDRA",
  // Japan
  JT1: "TOYOTA", JT2: "TOYOTA", JT3: "TOYOTA", JT4: "TOYOTA",
  JT5: "TOYOTA", JT6: "TOYOTA", JT7: "TOYOTA",
  JTD: "TOYOTA", JTE: "TOYOTA", JTF: "TOYOTA", JTG: "TOYOTA",
  JTH: "LEXUS", JTJ: "LEXUS", JTL: "LEXUS",
  JTM: "TOYOTA", JTN: "TOYOTA",
  JN1: "NISSAN", JN3: "NISSAN", JN6: "NISSAN", JN8: "NISSAN",
  JNA: "NISSAN", JNK: "NISSAN", JNR: "NISSAN", JNS: "NISSAN",
  JHM: "HONDA", JHN: "HONDA", JHL: "HONDA", JHG: "HONDA",
  JF1: "SUBARU", JF2: "SUBARU",
  JM1: "MAZDA", JMZ: "MAZDA", JM7: "MAZDA",
  JS1: "SUZUKI", JS2: "SUZUKI", JS3: "SUZUKI", JSA: "SUZUKI",
  JAA: "ISUZU", JAB: "ISUZU", JAC: "ISUZU", JAL: "ISUZU",
  JMY: "MITSUBISHI", JMB: "MITSUBISHI", JA3: "MITSUBISHI", JA4: "MITSUBISHI",
  // Korea
  KMH: "HYUNDAI", KMF: "HYUNDAI", KMJ: "HYUNDAI", KMX: "HYUNDAI",
  KMY: "HYUNDAI", KM8: "HYUNDAI",
  KNA: "KIA", KND: "KIA", KNE: "KIA", KNF: "KIA",
  KLA: "DAEWOO", KLP: "DAEWOO", KLY: "DAEWOO",
  KL1: "GM KOREA",
  // Germany
  WAU: "AUDI", WA1: "AUDI", WUA: "AUDI",
  WBA: "BMW", WBS: "BMW", WBW: "BMW", WBY: "BMW", WBX: "BMW",
  WDB: "MERCEDES-BENZ", WDC: "MERCEDES-BENZ", WDD: "MERCEDES-BENZ",
  WDF: "MERCEDES-BENZ", WMW: "MINI",
  WV1: "VOLKSWAGEN", WV2: "VOLKSWAGEN", WV3: "VOLKSWAGEN",
  WVG: "VOLKSWAGEN", WVW: "VOLKSWAGEN", WV9: "VOLKSWAGEN",
  WP0: "PORSCHE", WP1: "PORSCHE",
  // Italy
  ZFA: "FIAT", ZFC: "FIAT", ZFF: "FERRARI",
  ZAR: "ALFA ROMEO", ZAM: "MASERATI",
  // UK
  SAJ: "JAGUAR", SAL: "LAND ROVER", SAR: "ROVER",
  SCA: "ROLLS-ROYCE", SCB: "BENTLEY", SCC: "LOTUS",
  // France
  VF1: "RENAULT", VF2: "RENAULT", VF8: "MATRA",
  VF3: "PEUGEOT", VF7: "CITROEN",
  VF9: "BUGATTI",
  // Sweden
  YS3: "SAAB", YV1: "VOLVO",
  // China
  LFV: "VOLKSWAGEN CHINA", LSV: "VOLVO CHINA",
  LDC: "DONGFENG", LJV: "JAC", LFP: "FAW",
  LJ4: "BYD", LJ2: "BYD",
  // India
  MAH: "MAHINDRA", MA1: "MAHINDRA",
  MAT: "TATA", MA3: "SUZUKI INDIA",
  // USA
  "1FA": "FORD", "1FB": "FORD", "1FC": "FORD", "1FD": "FORD",
  "1FM": "FORD", "1FT": "FORD",
  "1G1": "CHEVROLET", "1G2": "PONTIAC", "1G3": "OLDSMOBILE",
  "1G4": "BUICK", "1G6": "CADILLAC", "1GC": "CHEVROLET", "1GT": "GMC",
  "2C3": "CHRYSLER", "2C4": "CHRYSLER",
  "1HG": "HONDA USA", "1J4": "JEEP",
};

export function vinToMake(vin: string): string {
  if (!vin || vin.length < 3) return "";
  return WMI_TO_MAKE[vin.substring(0, 3).toUpperCase()] || "";
}

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

export function vinToYear(vin: string): string {
  if (!vin || vin.length < 10) return "";
  const cleaned = vin.toUpperCase();
  const yearCode = cleaned[9];
  const positionSeven = cleaned[6];
  const codes = VIN_YEAR_CODES[yearCode];
  if (!codes) return "";
  const isOlderCycle = /[0-9]/.test(positionSeven);
  return String(isOlderCycle ? codes[0] : codes[1]);
}

export function vinToCountry(vin: string): string {
  if (!vin || vin.length < 2) return "";
  const prefix = vin.substring(0, 2).toUpperCase();
  const ranges: [string, string, string][] = [
    ["AA", "AH", "South Africa"],
    ["JA", "JT", "Japan"],
    ["KL", "KR", "South Korea"],
    ["LA", "L0", "China"],
    ["MA", "ME", "India"],
    ["SA", "SM", "United Kingdom"],
    ["VF", "VR", "France"],
    ["WA", "W0", "Germany"],
    ["YS", "YV", "Sweden"],
    ["ZA", "ZR", "Italy"],
    ["1A", "10", "United States"],
    ["2A", "20", "Canada"],
  ];
  for (const [start, end, name] of ranges) {
    if (prefix >= start && prefix <= end) return name;
  }
  return "";
}

// ============================================================
// SA Disc PDF417 parser
// ============================================================

export function parseSADisc(rawText: string): ParsedDisc | null {
  if (!rawText || typeof rawText !== "string") return null;
  const trimmed = rawText.trim();
  if (!trimmed.includes("|")) return null;

  const fields = trimmed.split("|").map((f) => f.trim());
  if (fields.length < 12) return null;

  const vin = fields[8] || "";
  const result: ParsedDisc = {
    make: (fields[6] || "").toUpperCase(),
    model: fields[7] || "",
    year: vinToYear(vin),
    vin,
    registrationNumber: fields[3] || "",
    colour: fields[10] || "",
    bodyType: normalizeBodyType(fields[5] || ""),
    raw: "[PDF417]",
  };

  if (!result.make && !result.registrationNumber && !result.vin) return null;
  return result;
}

export const MOCK_PARSED_DISC: ParsedDisc = {
  make: "TOYOTA",
  model: "HILUX 2.4 GD-6",
  year: "2022",
  vin: "AHTBB3CD500123456",
  registrationNumber: "CA 487 654",
  colour: "Silver",
  bodyType: "Bakkie (Double Cab)",
  raw: "[MOCK]",
};
