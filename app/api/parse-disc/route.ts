// app/api/parse-disc/route.ts
//
// POST: { image: dataUrl } → { success, parsed?: ParsedDisc, error? }
//
// Lean schema — extracts ONLY the 6 essential fields needed for a panel beater quote.
// Year is derived from VIN if Vision can't read it directly.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { vinToYear } from "@/lib/disc";

export const maxDuration = 30;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are reading a South African vehicle licence disc photo.
The disc shows printed fields in both English and Afrikaans (e.g. "Make / Fabrikaat", "Licence no / Lisensienr").

Extract ONLY these 5 fields via the extract_quote_essentials tool:
- make (manufacturer, UPPERCASE)
- model (full model name)
- vin (17-character chassis number)
- registrationNumber (licence plate, e.g. "JKF904FS" or "CA 487 654")
- colour (vehicle colour)

Rules:
- If a field is unclear, return empty string ""
- Do NOT invent values
- Preserve spacing in registration number as printed
- VIN must be exactly 17 alphanumeric characters
- Ignore all other fields on the disc (expiry, engine number, weights, etc.) — they're not needed.`;

const EXTRACT_TOOL = {
  name: "extract_quote_essentials",
  description: "Extract the 5 essential fields needed for a panel beater quote.",
  input_schema: {
    type: "object" as const,
    properties: {
      make: { type: "string", description: "Vehicle make in UPPERCASE" },
      model: { type: "string", description: "Vehicle model" },
      vin: { type: "string", description: "17-character VIN" },
      registrationNumber: { type: "string", description: "Licence plate / registration" },
      colour: { type: "string", description: "Vehicle colour" },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Reading confidence",
      },
    },
    required: ["make", "model", "vin", "registrationNumber", "colour", "confidence"],
  },
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { success: false, error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { image } = body as { image?: string };

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing image data" },
        { status: 400 }
      );
    }

    const match = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { success: false, error: "Invalid image format" },
        { status: 400 }
      );
    }
    const [, mediaType, base64Data] = match;

    const validMediaTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validMediaTypes.includes(mediaType)) {
      return NextResponse.json(
        { success: false, error: `Unsupported media type: ${mediaType}` },
        { status: 400 }
      );
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_quote_essentials" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: base64Data,
              },
            },
            {
              type: "text",
              text: "Extract the 5 essential fields from this licence disc.",
            },
          ],
        },
      ],
    });

    const toolUseBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        { success: false, error: "Vision did not return structured data" },
        { status: 500 }
      );
    }

    const extracted = toolUseBlock.input as Record<string, string>;
    const vin = (extracted.vin || "").toUpperCase().replace(/\s+/g, "");

    const parsed = {
      make: (extracted.make || "").toUpperCase(),
      model: extracted.model || "",
      year: vinToYear(vin), // Derive year from VIN
      vin,
      registrationNumber: extracted.registrationNumber || "",
      colour: extracted.colour || "",
      raw: "[VISION]",
    };

    return NextResponse.json({
      success: true,
      parsed,
      confidence: extracted.confidence || "medium",
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    });
  } catch (error) {
    console.error("Vision parsing error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
