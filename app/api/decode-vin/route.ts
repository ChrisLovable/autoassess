// app/api/decode-vin/route.ts
//
// POST: { vin: "KMHBT51DR6U547402" } → { make, model, year, bodyType, country }
//
// ZERO HALLUCINATION sources:
//   1. Programmatic WMI lookup (make)
//   2. ISO position 10 (year)
//   3. WMI prefix (country)
//   4. NHTSA Vehicle API (model, body type — manufacturer-submitted)
//
// If a source returns nothing, the field stays EMPTY. We never guess.

import { NextRequest, NextResponse } from "next/server";
import { vinToMake, vinToYear, vinToCountry, normalizeBodyType } from "@/lib/disc";

export const maxDuration = 10;

type NhtsaResult = {
  Make?: string;
  Model?: string;
  ModelYear?: string;
  BodyClass?: string;
  VehicleType?: string;
  Manufacturer?: string;
  PlantCountry?: string;
  ErrorCode?: string;
  ErrorText?: string;
};

async function tryNhtsaDecode(vin: string): Promise<NhtsaResult | null> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { Results?: NhtsaResult[] };
    return data?.Results?.[0] || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { vin } = body as { vin?: string };

    if (!vin || typeof vin !== "string") {
      return NextResponse.json({ success: false, error: "Missing VIN" }, { status: 400 });
    }

    const cleanVin = vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleanVin.length !== 17) {
      return NextResponse.json(
        { success: false, error: "VIN must be exactly 17 characters" },
        { status: 400 }
      );
    }
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
      return NextResponse.json(
        { success: false, error: "VIN contains invalid characters (I, O, Q not allowed)" },
        { status: 400 }
      );
    }

    // Programmatic decoding (deterministic)
    const programmaticMake = vinToMake(cleanVin);
    const programmaticYear = vinToYear(cleanVin);
    const programmaticCountry = vinToCountry(cleanVin);

    // NHTSA decoding (free, manufacturer-submitted)
    const nhtsa = await tryNhtsaDecode(cleanVin);

    // Merge — programmatic preferred where authoritative; NHTSA fills gaps
    const make =
      programmaticMake ||
      (nhtsa?.Make ? nhtsa.Make.toUpperCase() : "") ||
      (nhtsa?.Manufacturer ? nhtsa.Manufacturer.toUpperCase() : "");

    // Model: NHTSA only (programmatic can't reliably give model)
    let model = "";
    if (nhtsa?.Model && !/^not applicable$/i.test(nhtsa.Model)) {
      model = nhtsa.Model;
    }

    // Body type: normalize NHTSA's BodyClass to SA terms
    const bodyType = normalizeBodyType(nhtsa?.BodyClass || "");

    const year = programmaticYear || nhtsa?.ModelYear || "";
    const country = programmaticCountry || nhtsa?.PlantCountry || "";

    const filledFields = [make, model, year, bodyType, country].filter(Boolean).length;
    let confidence: "high" | "medium" | "low" = "low";
    if (filledFields >= 4) confidence = "high";
    else if (filledFields >= 2) confidence = "medium";

    return NextResponse.json({
      success: true,
      vin: cleanVin,
      make,
      model,
      year,
      bodyType,
      country,
      confidence,
      sources: {
        programmatic: {
          make: !!programmaticMake,
          year: !!programmaticYear,
          country: !!programmaticCountry,
        },
        nhtsa: nhtsa ? { ok: !nhtsa.ErrorText, raw: nhtsa.ErrorText || null } : { ok: false },
      },
    });
  } catch (error) {
    console.error("VIN decode error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
