// app/api/transcribe/route.ts
//
// POST: multipart/form-data with "audio" file → { text } or { error }
// Uses ElevenLabs Scribe v1 (English).

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY not configured" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    // Size guard — reject anything stupid huge (>10 MB)
    if (audioFile.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Audio too large (max 10MB)" }, { status: 413 });
    }
    if (audioFile.size === 0) {
      return NextResponse.json({ error: "Audio is empty" }, { status: 400 });
    }

    // Forward to ElevenLabs Scribe
    const elevenLabsForm = new FormData();
    elevenLabsForm.append("file", audioFile, "recording.webm");
    elevenLabsForm.append("model_id", "scribe_v1");
    elevenLabsForm.append("language_code", "eng");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
      body: elevenLabsForm,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs error:", response.status, errorText);
      return NextResponse.json(
        { error: `Transcription failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as { text?: string };
    return NextResponse.json({ text: (data.text || "").trim() });
  } catch (error) {
    console.error("Transcribe error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
