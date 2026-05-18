"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { vinToYear, type ParsedDisc, type VehicleDetails } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_METHOD = "autoassess:parseMethod";

type Status = "idle" | "recording" | "transcribing" | "decoding" | "decoded" | "error";

function isValidVinFormat(vin: string): boolean {
  return vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function normalizeVinTranscript(text: string): string {
  let v = text.toUpperCase();
  const nato: Record<string, string> = {
    ALPHA: "A", BRAVO: "B", CHARLIE: "C", DELTA: "D", ECHO: "E",
    FOXTROT: "F", GOLF: "G", HOTEL: "H", INDIA: "I", JULIET: "J",
    KILO: "K", LIMA: "L", MIKE: "M", NOVEMBER: "N", OSCAR: "O",
    PAPA: "P", QUEBEC: "Q", ROMEO: "R", SIERRA: "S", TANGO: "T",
    UNIFORM: "U", VICTOR: "V", WHISKEY: "W", XRAY: "X",
    YANKEE: "Y", ZULU: "Z",
    ZERO: "0", ONE: "1", TWO: "2", THREE: "3", FOUR: "4",
    FIVE: "5", SIX: "6", SEVEN: "7", EIGHT: "8", NINE: "9",
  };
  for (const [word, letter] of Object.entries(nato)) {
    v = v.replace(new RegExp(`\\b${word}\\b`, "g"), letter);
  }
  v = v.replace(/[^A-Z0-9]/g, "");
  v = v.replace(/I/g, "1").replace(/O/g, "0").replace(/Q/g, "0");
  return v;
}

export default function VinEntryPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [vin, setVin] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (stream.current) { stream.current.getTracks().forEach((t) => t.stop()); stream.current = null; }
  }, []);

  const stop = useCallback(() => {
    if (mr.current && mr.current.state !== "inactive") mr.current.stop();
  }, []);

  const start = useCallback(async () => {
    setErrorMsg(""); setRawTranscript(""); chunks.current = [];
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setStatus("error"); setErrorMsg("Microphone not available"); return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = s;
      const mimes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
      let mime = "";
      for (const m of mimes) if (m === "" || MediaRecorder.isTypeSupported(m)) { mime = m; break; }
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      r.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      r.onstop = async () => {
        cleanup();
        if (chunks.current.length === 0) { setStatus("idle"); return; }
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 1000) { setStatus("idle"); return; }
        setStatus("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, "vin.webm");
          const resp = await fetch("/api/transcribe", { method: "POST", body: fd });
          const j = (await resp.json()) as { text?: string; error?: string };
          if (!resp.ok || j.error) { setStatus("error"); setErrorMsg(j.error || "Transcription failed"); return; }
          const t = (j.text || "").trim();
          setRawTranscript(t);
          setVin(normalizeVinTranscript(t));
          setStatus("idle");
        } catch (e) {
          setStatus("error"); setErrorMsg(e instanceof Error ? e.message : "Network error");
        }
      };
      mr.current = r;
      r.start();
      setStatus("recording");
    } catch (err) {
      setStatus("error");
      const e = err as { name?: string };
      setErrorMsg(e.name === "NotAllowedError" ? "Microphone permission denied" : "Could not start mic");
    }
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status === "idle" || status === "error") start();
  }, [status, start, stop]);

  useEffect(() => () => { if (mr.current?.state === "recording") mr.current.stop(); cleanup(); }, [cleanup]);

  const decode = useCallback(async () => {
    if (!isValidVinFormat(vin)) { setErrorMsg("VIN must be exactly 17 characters (A-Z, 0-9, no I/O/Q)"); return; }
    setStatus("decoding"); setErrorMsg("");
    try {
      const resp = await fetch("/api/decode-vin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin }),
      });
      const r = (await resp.json()) as {
        success: boolean; make?: string; model?: string; year?: string; bodyType?: string;
        country?: string; confidence?: string; details?: VehicleDetails; error?: string;
      };
      if (!resp.ok || !r.success) { setStatus("error"); setErrorMsg(r.error || "VIN decode failed"); return; }

      const parsed: ParsedDisc = {
        make: (r.make || "").toUpperCase(),
        model: r.model || "",
        year: r.year || vinToYear(vin),
        vin,
        registrationNumber: "",
        colour: "",
        bodyType: r.bodyType || "",
        raw: "[VIN_VOICE]",
        details: r.details,
      };
      try {
        sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(parsed));
        sessionStorage.setItem(STORAGE_KEY_METHOD, `vin-voice:${r.confidence || "?"}`);
      } catch {}
      setStatus("decoded");
      setTimeout(() => router.push("/assessments/new/vehicle"), 500);
    } catch (e) {
      setStatus("error"); setErrorMsg(e instanceof Error ? e.message : "Network error");
    }
  }, [vin, router]);

  const skipToManual = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY_PARSED);
    router.push("/assessments/new/vehicle?manual=1");
  }, [router]);

  const charsRemaining = 17 - vin.length;
  const isValid = isValidVinFormat(vin);

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top">
        <button onClick={() => router.back()} className="haptic-tap text-white/60 hover:text-white text-sm">← Back</button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">Step 1 of 5 · VIN</div>
      </div>

      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="text-[10px] font-mono uppercase tracking-wider text-gold mb-2">Identify vehicle</div>
        <h1 className="font-display text-2xl font-bold mb-2">Speak the VIN</h1>
        <p className="text-sm text-white/60 mb-8">
          17 characters from the licence disc. We&apos;ll pull make, model, year, body type, engine, ADAS features and more.
        </p>

        <div className="flex flex-col items-center mb-8">
          <button onClick={toggle} disabled={status === "transcribing" || status === "decoding"}
            className={`haptic-tap w-28 h-28 rounded-full flex items-center justify-center transition-all ${
              status === "recording" ? "bg-red-500/20 border-2 border-red-500 animate-pulse"
              : status === "transcribing" || status === "decoding" ? "bg-gold/10 border-2 border-gold/30 opacity-60"
              : "bg-gold/15 border-2 border-gold hover:bg-gold/25"
            }`}>
            {status === "recording" ? <svg width="40" height="40" viewBox="0 0 24 24" fill="#EF4444"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              : status === "transcribing" || status === "decoding" ? <div className="w-10 h-10 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
              : <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </svg>}
          </button>
          <div className="mt-4 text-xs font-mono uppercase tracking-wider text-center">
            {status === "recording" && <span className="text-red-400">● Recording — tap to stop</span>}
            {status === "transcribing" && <span className="text-gold">Transcribing</span>}
            {status === "decoding" && <span className="text-gold">Decoding VIN</span>}
            {status === "decoded" && <span className="text-emerald-400">✓ Vehicle identified</span>}
            {(status === "idle" || status === "error") && <span className="text-white/40">Tap to speak the VIN</span>}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">VIN</div>
            <div className={`text-[10px] font-mono uppercase tracking-wider ${
              isValid ? "text-emerald-400" : charsRemaining > 0 ? "text-white/40" : "text-amber-400"
            }`}>{vin.length}/17</div>
          </div>
          <input type="text" value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17))}
            className="w-full bg-transparent border-none outline-none font-mono text-lg text-white tracking-wider"
            autoCorrect="off" autoCapitalize="characters" maxLength={17}
          />
          {rawTranscript && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-[9px] font-mono uppercase tracking-wider text-white/30">You said</div>
              <div className="text-xs text-white/50 italic">&ldquo;{rawTranscript}&rdquo;</div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-sm text-red-300">{errorMsg}</div>
        )}

        <div className="bg-surface/50 border border-border/50 rounded-xl p-3 mb-4 text-xs text-white/50">
          <div className="font-mono uppercase tracking-wider text-white/40 mb-1 text-[9px]">Tip</div>
          Use NATO phonetic for clarity:{" "}
          <span className="text-white/70">&ldquo;Kilo Mike Hotel Bravo Tango Five One...&rdquo;</span>{" "}
          or speak letter-by-letter.
        </div>
      </div>

      <div className="px-4 py-4 border-t border-border bg-bg safe-bottom">
        <div className="max-w-md mx-auto flex flex-col gap-2">
          <button onClick={decode} disabled={!isValid || status === "decoding"}
            className="haptic-tap w-full bg-gold text-black font-semibold py-3.5 rounded-xl text-base disabled:opacity-40">
            {status === "decoding" ? "Decoding..." : "Look up vehicle"}
          </button>
          <button onClick={skipToManual}
            className="haptic-tap w-full border border-border text-white/70 py-2.5 rounded-xl text-xs">
            Enter all details manually
          </button>
        </div>
      </div>
    </div>
  );
}
