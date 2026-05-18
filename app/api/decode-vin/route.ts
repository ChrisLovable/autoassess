// app/api/decode-vin/route.ts
//
// POST: { vin } → comprehensive vehicle data from NHTSA + programmatic decoders.
// ZERO HALLUCINATION: blank fields when source returns nothing.

import { NextRequest, NextResponse } from "next/server";
import { vinToMake, vinToYear, vinToCountry, normalizeBodyType, type VehicleDetails } from "@/lib/disc";

export const maxDuration = 10;

// All NHTSA fields we care about (camelCase key → NHTSA field name)
type NhtsaRaw = Record<string, string | undefined>;

async function tryNhtsaDecode(vin: string): Promise<NhtsaRaw | null> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { Results?: NhtsaRaw[] };
    return data?.Results?.[0] || null;
  } catch {
    return null;
  }
}

/** Strip empty/N-A values from NHTSA responses */
function clean(value: string | undefined): string {
  if (!value) return "";
  const v = value.trim();
  if (!v) return "";
  if (/^not applicable$/i.test(v) || /^n\/?a$/i.test(v)) return "";
  return v;
}

/** Map NHTSA raw response → our structured VehicleDetails */
function extractDetails(n: NhtsaRaw): VehicleDetails {
  return {
    // Identification
    trim: clean(n.Trim),
    series: clean(n.Series),
    vehicleType: clean(n.VehicleType),
    bodyCabType: clean(n.BodyCabType),
    doors: clean(n.Doors),

    // Engine
    engineModel: clean(n.EngineModel),
    engineConfiguration: clean(n.EngineConfiguration),
    engineCylinders: clean(n.EngineCylinders),
    engineDisplacementL: clean(n.DisplacementL),
    engineHP: clean(n.EngineHP),
    fuelTypePrimary: clean(n.FuelTypePrimary),
    fuelTypeSecondary: clean(n.FuelTypeSecondary),
    valveTrainDesign: clean(n.ValveTrainDesign),

    // Drivetrain
    transmissionStyle: clean(n.TransmissionStyle),
    transmissionSpeeds: clean(n.TransmissionSpeeds),
    driveType: clean(n.DriveType),

    // Dimensions / weight
    gvwr: clean(n.GVWR),
    curbWeightLB: clean(n.CurbWeightLB),
    wheelBaseIN: clean(n.WheelBaseLong) || clean(n.WheelBaseShort),
    wheelSizeFront: clean(n.WheelSizeFront),
    wheelSizeRear: clean(n.WheelSizeRear),
    bedLengthIN: clean(n.BedLengthIN),
    bedType: clean(n.BedType),

    // Safety / ADAS
    abs: clean(n.ABS),
    esc: clean(n.ESC),
    tractionControl: clean(n.TractionControl),
    airBagLocFront: clean(n.AirBagLocFront),
    airBagLocSide: clean(n.AirBagLocSide),
    airBagLocCurtain: clean(n.AirBagLocCurtain),
    airBagLocKnee: clean(n.AirBagLocKnee),
    airBagLocSeatCushion: clean(n.AirBagLocSeatCushion),
    forwardCollisionWarning: clean(n.ForwardCollisionWarning),
    laneDepartureWarning: clean(n.LaneDepartureWarning),
    laneKeepSystem: clean(n.LaneKeepSystem),
    blindSpotMon: clean(n.BlindSpotMon),
    blindSpotIntervention: clean(n.BlindSpotIntervention),
    backupCamera: clean(n.RearVisibilitySystem) || clean(n.BackupCamera),
    parkAssist: clean(n.ParkAssist),
    adaptiveCruiseControl: clean(n.AdaptiveCruiseControl),
    dynamicBrakeSupport: clean(n.DynamicBrakeSupport),
    pedestrianAutomaticEmergencyBraking: clean(n.PedestrianAutomaticEmergencyBraking),
    autoReverseSystem: clean(n.AutoReverseSystem),
    daytimeRunningLight: clean(n.DaytimeRunningLight),
    keylessIgnition: clean(n.KeylessIgnition),
    tpms: clean(n.TPMS),

    // Plant
    plantCountry: clean(n.PlantCountry),
    plantState: clean(n.PlantState),
    plantCity: clean(n.PlantCity),
    plantCompanyName: clean(n.PlantCompanyName),
    manufacturer: clean(n.Manufacturer),

    // EV
    electrificationLevel: clean(n.ElectrificationLevel),
    batteryKWh: clean(n.BatteryKWh),
    chargerLevel: clean(n.ChargerLevel),
    evDriveUnit: clean(n.EVDriveUnit),
  };
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
      return NextResponse.json({ success: false, error: "VIN must be exactly 17 characters" }, { status: 400 });
    }
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
      return NextResponse.json({ success: false, error: "VIN contains invalid characters (I, O, Q not allowed)" }, { status: 400 });
    }

    // Programmatic decoding
    const programmaticMake = vinToMake(cleanVin);
    const programmaticYear = vinToYear(cleanVin);
    const programmaticCountry = vinToCountry(cleanVin);

    // NHTSA decoding
    const nhtsa = await tryNhtsaDecode(cleanVin);

    // Top-level fields (priority: programmatic > NHTSA, both for cross-check)
    const make = programmaticMake || (nhtsa ? clean(nhtsa.Make).toUpperCase() : "") || (nhtsa ? clean(nhtsa.Manufacturer).toUpperCase() : "");
    const model = nhtsa ? clean(nhtsa.Model) : "";
    const bodyType = normalizeBodyType(nhtsa ? clean(nhtsa.BodyClass) : "");
    const year = programmaticYear || (nhtsa ? clean(nhtsa.ModelYear) : "");
    const country = programmaticCountry || (nhtsa ? clean(nhtsa.PlantCountry) : "");

    // Full structured details
    const details = nhtsa ? extractDetails(nhtsa) : undefined;

    // Confidence based on filled top fields
    const filled = [make, model, year, bodyType].filter(Boolean).length;
    const confidence: "high" | "medium" | "low" = filled >= 4 ? "high" : filled >= 2 ? "medium" : "low";

    return NextResponse.json({
      success: true,
      vin: cleanVin,
      make,
      model,
      year,
      bodyType,
      country,
      confidence,
      details,
      sources: {
        programmatic: { make: !!programmaticMake, year: !!programmaticYear, country: !!programmaticCountry },
        nhtsa: nhtsa ? { ok: true, errorText: nhtsa.ErrorText || null } : { ok: false, errorText: null },
      },
    });
  } catch (error) {
    console.error("VIN decode error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
