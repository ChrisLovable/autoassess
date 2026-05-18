// lib/disc.ts
// South African vehicle licence disc PDF417 barcode parser.

export type ParsedDisc = {
  licenceNumber: string;
  registrationNumber: string;
  vehicleRegisterNumber: string;
  description: string;
  make: string;
  model: string;
  vin: string;
  engineNumber: string;
  colour: string;
  expiryDate: string;
  raw: string;
};

export function parseSADisc(rawText: string): ParsedDisc | null {
  if (!rawText || typeof rawText !== "string") return null;

  const trimmed = rawText.trim();
  if (!trimmed.includes("|")) return null;

  const fields = trimmed.split("|").map((f) => f.trim());
  if (fields.length < 12) return null;

  const parsed: ParsedDisc = {
    licenceNumber: fields[2] || "",
    registrationNumber: fields[3] || "",
    vehicleRegisterNumber: fields[4] || "",
    description: fields[5] || "",
    make: fields[6] || "",
    model: fields[7] || "",
    vin: fields[8] || "",
    engineNumber: fields[9] || "",
    colour: fields[10] || "",
    expiryDate: fields[11] || "",
    raw: trimmed,
  };

  if (!parsed.make && !parsed.registrationNumber && !parsed.vin) return null;

  return parsed;
}

export const MOCK_PARSED_DISC: ParsedDisc = {
  licenceNumber: "L23456789",
  registrationNumber: "CA 487 654",
  vehicleRegisterNumber: "VR123456",
  description: "Light Delivery Vehicle (Double Cab)",
  make: "TOYOTA",
  model: "HILUX 2.4 GD-6 RB RAIDER D/C",
  vin: "AHTBB3CD500123456",
  engineNumber: "2GD-A123456",
  colour: "Silver",
  expiryDate: "2026-08-31",
  raw: "[MOCK]",
};