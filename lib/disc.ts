/**
 * SA Vehicle Licence Disc Parser
 *
 * The disc has a PDF417 barcode containing pipe-delimited plaintext.
 * This module:
 *  1. Parses a raw barcode string into a structured ParsedDisc
 *  2. Validates that the string looks like a real SA disc
 *
 * For the camera capture + barcode detection itself, use @zxing/library
 * (added in v2 of the disc scanner).
 *
 * Field positions vary slightly between disc versions, so we use
 * heuristic field detection (VIN regex, reg regex, known makes list)
 * rather than positional parsing.
 */

export interface ParsedDisc {
  controlNumber: string | null;
  licenceNumber: string | null;
  registrationNumber: string | null;
  vehicleDescription: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  engineNumber: string | null;
  licenceExpiry: string | null;
  year: number | null;
  colour: string | null;
  raw: string;
  rawFields: string[];
  confidence: 'high' | 'medium' | 'low';
}

const KNOWN_MAKES = [
  'TOYOTA',
  'VOLKSWAGEN',
  'VW',
  'FORD',
  'HYUNDAI',
  'KIA',
  'BMW',
  'MERCEDES',
  'MERCEDES-BENZ',
  'NISSAN',
  'HONDA',
  'MAZDA',
  'RENAULT',
  'OPEL',
  'CHEVROLET',
  'ISUZU',
  'MITSUBISHI',
  'SUZUKI',
  'SUBARU',
  'AUDI',
  'VOLVO',
  'LAND ROVER',
  'JAGUAR',
  'MINI',
  'PORSCHE',
  'GWM',
  'HAVAL',
  'MAHINDRA',
  'TATA',
  'PEUGEOT',
  'CITROEN',
  'FIAT',
  'ALFA ROMEO',
  'LEXUS',
  'CHERY',
  'JEEP',
  'DODGE',
  'RAM',
];

export function parseSADisc(raw: string): ParsedDisc {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Invalid disc data');
  }

  // Split on % or | (both observed as delimiters across disc versions)
  const fields = raw
    .split(/[%|]/)
    .map((f) => f.trim())
    .filter(Boolean);

  const parsed: ParsedDisc = {
    controlNumber: null,
    licenceNumber: null,
    registrationNumber: null,
    vehicleDescription: null,
    make: null,
    model: null,
    vin: null,
    engineNumber: null,
    licenceExpiry: null,
    year: null,
    colour: null,
    raw,
    rawFields: fields,
    confidence: 'low',
  };

  // VIN: 17 alphanumeric chars, no I/O/Q
  const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
  parsed.vin = fields.find((f) => vinPattern.test(f)) ?? null;

  // SA registration plate
  const regPattern = /^[A-Z]{2,3}[\s-]?\d{1,6}[\s-]?[A-Z]{0,2}$/i;
  parsed.registrationNumber = fields.find((f) => regPattern.test(f)) ?? null;

  // Engine number: 6-17 alphanumeric, has both letters & digits
  const enginePattern = /^[A-Z0-9]{6,17}$/;
  parsed.engineNumber =
    fields
      .filter((f) => f !== parsed.vin && enginePattern.test(f))
      .find((f) => /[A-Z]/.test(f) && /\d/.test(f)) ?? null;

  // Date — ISO or DD/MM/YYYY or DD-MM-YYYY
  const datePattern = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}|\d{2}-\d{2}-\d{4})$/;
  parsed.licenceExpiry = fields.find((f) => datePattern.test(f)) ?? null;

  // Vehicle description
  const descPattern = /(passenger|light|heavy|motor\s*cycle|truck|bus|trailer)/i;
  parsed.vehicleDescription = fields.find((f) => descPattern.test(f)) ?? null;

  // Make + model
  const makeIdx = fields.findIndex((f) =>
    KNOWN_MAKES.includes(f.toUpperCase().trim()),
  );
  if (makeIdx >= 0) {
    parsed.make = fields[makeIdx];
    if (makeIdx + 1 < fields.length) {
      parsed.model = fields[makeIdx + 1];
    }
  }

  // Year — 4-digit number in 1980-2030 range, not already claimed
  const yearPattern = /^(19[8-9]\d|20[0-2]\d|2030)$/;
  const yearField = fields.find((f) => yearPattern.test(f));
  if (yearField) parsed.year = parseInt(yearField, 10);

  // Confidence scoring
  const filled = [
    parsed.vin,
    parsed.registrationNumber,
    parsed.make,
    parsed.model,
    parsed.licenceExpiry,
  ].filter(Boolean).length;

  if (filled >= 4) parsed.confidence = 'high';
  else if (filled >= 2) parsed.confidence = 'medium';
  else parsed.confidence = 'low';

  return parsed;
}

export function isValidSADisc(raw: string): boolean {
  try {
    const parsed = parseSADisc(raw);
    return (
      parsed.confidence !== 'low' &&
      (parsed.vin !== null || parsed.registrationNumber !== null)
    );
  } catch {
    return false;
  }
}

/**
 * MOCK — returns a deterministic mock vehicle for development.
 * In production this is replaced by a real PDF417 scan + parseSADisc.
 */
export const MOCK_PARSED_DISC: ParsedDisc = {
  controlNumber: '12345678',
  licenceNumber: '987654321',
  registrationNumber: 'CA 487 654',
  vehicleDescription: 'Light Passenger Vehicle',
  make: 'TOYOTA',
  model: 'HILUX 2.4 GD-6',
  year: 2022,
  colour: 'WHITE',
  vin: 'AHTKB3CD500123456',
  engineNumber: '2GD1234567',
  licenceExpiry: '2026-08-31',
  raw: 'MOCK',
  rawFields: [],
  confidence: 'high',
};
