// app/api/decode-vin/route.ts
//
// POST: { vin: "KMHBT51DR6U547402" } â†’ { make, model, year, bodyType, country, confidence }
//
// Uses Claude with tool_use for structured VIN decoding.
// Combines programmatic decoding (year from position 10, country from WMI)
// with Claude's broader automotive knowledge for model/body type.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { vinToYear, vinToCountry } from "@/lib/disc";

export const maxDuration = 30;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert in vehicle identification numbers (VINs).
Given a 17-character VIN, decode the vehicle details using:
- World Manufacturer Identifier (WMI): positions 1-3
- Vehicle Descriptor Section (VDS): positions 4-8 â€” model, body type, engine
- Position 10: model year code
- Position 11: assembly plant
- Position 12-17: serial number

Use your knowledge of manufacturer-specific VIN patterns. Common SA vehicles include:
- Toyota, Hyundai, Ford, Volkswagen, Nissan, BMW, Mercedes-Benz, Isuzu, Kia, Renault
- Many SA Hilux/Bakkies have WMI starting AHT (South Africa) or JT (Japan)
- Hyundai Korean WMI: KMH

If you're confident about a field, fill it in. If uncertain, return an empty string.
NEVER invent or guess specific model trims you're not sure about â€” better to leave model partial than wrong.`;

const DECODE_TOOL = {
  name: "decode_vin",
  description: "Decode a 17-character VIN into vehicle details.",
  input_schema: {
    type: "object" as const,
    properties: {
      make: {
        type: "string",
        description: "Manufacturer in UPPERCASE (e.g. TOYOTA, HYUNDAI, FORD)",
      },
      model: {
        type: "string",
        description: "Vehicle model name and variant if known (e.g. 'Hilux 2.4 GD-6', 'Sonata', 'Polo Vivo'). Leave empty if uncertain.",
      },
      year: {
        type: "string",
        description: "4-digit model year (e.g. '2022')",
      },
      bodyType: {
        type: "string",
        description: "Body type (Sedan, Hatchback, SUV, Bakkie, Coupe, etc.)",
      },
      country: {
        type: "string",
        description: "Country of manufacture (e.g. 'South Africa', 'Japan', 'South Korea')",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence in the model/body decoding. 'high' = WMI well-known + VDS pattern recognized. 'low' = generic guess.",
      },
    },
    required: ["make", "year", "country", "confidence"],
  },
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { success: false, error: "ANTHROPIC_API_KEY not configured on server" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { vin } = body as { vin?: string };

    if (!vin || typeof vin !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing VIN" },
        { status: 400 }
      );
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

    // Programmatic decoding (always reliable)
    const derivedYear = vinToYear(cleanVin);
    const derivedCountry = vinToCountry(cleanVin);

    // Ask Claude for fuller decoding
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [DECODE_TOOL],
      tool_choice: { type: "tool", name: "decode_vin" },
      messages: [
        {
          role: "user",
          content: `Decode this VIN: ${cleanVin}

Structural hints (already derived from VIN positions):
- Year from position 10: ${derivedYear || "unknown"}
- Country from WMI: ${derivedCountry || "unknown"}

Now use the WMI (${cleanVin.substring(0, 3)}) and VDS (${cleanVin.substring(3, 8)}) to determine make, model, and body type.`,
        },
      ],
    });

    const toolUseBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        { success: false, error: "VIN decoder returned no structured data" },
        { status: 500 }
      );
    }

    const decoded = toolUseBlock.input as Record<string, string>;

    return NextResponse.json({
      success: true,
      vin: cleanVin,
      make: (decoded.make || "").toUpperCase(),
      model: decoded.model || "",
      year: decoded.year || derivedYear,
      bodyType: decoded.bodyType || "",
      country: decoded.country || derivedCountry,
      confidence: decoded.confidence || "medium",
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error("VIN decode error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
