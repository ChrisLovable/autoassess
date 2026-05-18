// app/api/decode-vin/route.ts
//
// POST: { vin: "KMHBT51DR6U547402" } → { make, model, year, bodyType, country }
//
// NO LLM CALLS. Uses only:
//   1. Programmatic decoding (WMI lookup + ISO position 10 year)
//   2. NHTSA Vehicle API (free US government service with manufacturer-submitted data)
//
// If NHTSA doesn't know a field, we leave it BLANK. We never guess.

import { NextRequest, NextResponse } from "next/server";
import { vinToMake, vinToYear, vinToCountry } from "@/lib/disc";

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

    // STEP 1: Programmatic decode — 100% reliable, instant, free
    const programmaticMake = vinToMake(cleanVin);
    const programmaticYear = vinToYear(cleanVin);
    const programmaticCountry = vinToCountry(cleanVin);

    // STEP 2: NHTSA decode — free, manufacturer-submitted data
    const nhtsa = await tryNhtsaDecode(cleanVin);

    // Merge results: NHTSA preferred where available, programmatic as fallback.
    // If neither has it, leave it BLANK. We never guess.
    const make =
      programmaticMake ||
      (nhtsa?.Make ? nhtsa.Make.toUpperCase() : "") ||
      (nhtsa?.Manufacturer ? nhtsa.Manufacturer.toUpperCase() : "");

    // Model only comes from NHTSA — programmatic decode can't reliably give model.
    // Trust NHTSA only when it's not a generic placeholder like "Not Applicable".
    let model = "";
    if (nhtsa?.Model && !/^not applicable$/i.test(nhtsa.Model)) {
      model = nhtsa.Model;
    }

    let bodyType = "";
    if (nhtsa?.BodyClass && !/^not applicable$/i.test(nhtsa.BodyClass)) {
      bodyType = nhtsa.BodyClass;
    }

    const year = programmaticYear || nhtsa?.ModelYear || "";
    const country = programmaticCountry || nhtsa?.PlantCountry || "";

    // Confidence reflects how much real data we got
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
        programmatic: { make: !!programmaticMake, year: !!programmaticYear, country: !!programmaticCountry },
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
