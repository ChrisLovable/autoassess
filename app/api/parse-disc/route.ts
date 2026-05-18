// app/api/parse-disc/route.ts
//
// POST: { image: dataUrl }  → { success, parsed?: ParsedDisc, error?: string }
//
// Uses Claude Sonnet 4.5 Vision with tool_use to force structured JSON output.
// Image expected to be base64 data URL (data:image/jpeg;base64,...).

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30; // seconds — give Vision call time

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert at reading South African vehicle licence discs.
The disc contains printed text fields in both English and Afrikaans (e.g. "Licence no / Lisensienr", "Make / Fabrikaat").
Extract the visible fields and return them via the extract_disc_fields tool.

Rules:
- If a field is unclear or unreadable, return an empty string "" for that field
- Do NOT invent or guess data
- VIN must be exactly 17 alphanumeric characters
- Registration number format: 6-7 chars, e.g. "JKF904FS" or "CA 487 654" — preserve original spacing
- Make should be UPPERCASE
- Expiry date format: YYYY-MM-DD
- Description / Beskrywing = body type (e.g. "Sedan (closed top)", "Light Delivery Vehicle")`;

const EXTRACT_TOOL = {
  name: "extract_disc_fields",
  description: "Extract fields from a South African vehicle licence disc image.",
  input_schema: {
    type: "object" as const,
    properties: {
      make: { type: "string", description: "Vehicle make/manufacturer in UPPERCASE (Fabrikaat)" },
      model: { type: "string", description: "Vehicle model" },
      registrationNumber: { type: "string", description: "Registration/licence plate number (Lisensienr)" },
      vin: { type: "string", description: "17-character VIN/chassis number" },
      engineNumber: { type: "string", description: "Engine number (Enjinnr)" },
      colour: { type: "string", description: "Vehicle colour" },
      description: { type: "string", description: "Body type / Beskrywing, e.g. 'Sedan (closed top)'" },
      expiryDate: { type: "string", description: "Licence expiry date in YYYY-MM-DD format (Vervaldatum)" },
      vehicleRegisterNumber: { type: "string", description: "Vehicle register number (Voertuigregister no)" },
      licenceNumber: { type: "string", description: "Licence document number (NO. at top)" },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence that fields are correctly read"
      },
    },
    required: ["make", "model", "registrationNumber", "vin", "confidence"],
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

    // Extract base64 + media type from data URL
    const match = image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { success: false, error: "Invalid image format — expected data URL" },
        { status: 400 }
      );
    }
    const [, mediaType, base64Data] = match;

    // Validate media type
    const validMediaTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!validMediaTypes.includes(mediaType)) {
      return NextResponse.json(
        { success: false, error: `Unsupported media type: ${mediaType}` },
        { status: 400 }
      );
    }

    // Call Claude Vision with forced tool use
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_disc_fields" },
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
              text: "Extract the visible fields from this South African vehicle licence disc.",
            },
          ],
        },
      ],
    });

    // Find the tool_use block in response
    const toolUseBlock = message.content.find((block) => block.type === "tool_use");
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        { success: false, error: "Vision did not return structured data" },
        { status: 500 }
      );
    }

    const extracted = toolUseBlock.input as Record<string, string>;

    // Build the ParsedDisc-compatible response
    const parsed = {
      make: (extracted.make || "").toUpperCase(),
      model: extracted.model || "",
      registrationNumber: extracted.registrationNumber || "",
      vin: extracted.vin || "",
      engineNumber: extracted.engineNumber || "",
      colour: extracted.colour || "",
      description: extracted.description || "",
      expiryDate: extracted.expiryDate || "",
      vehicleRegisterNumber: extracted.vehicleRegisterNumber || "",
      licenceNumber: extracted.licenceNumber || "",
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
