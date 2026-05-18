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

// ============================================================
// Natural letter/number map — how people ACTUALLY speak each char
// ============================================================
const TOKEN_MAP: Record<string, string> = {
  // Letters
  "A": "A", "AY": "A", "AYE": "A",
  "B": "B", "BE": "B", "BEE": "B", "BEEN": "B",
  "C": "C", "SEE": "C", "SEA": "C", "CEE": "C",
  "D": "D", "DEE": "D",
  "E": "E", "EE": "E",
  "F": "F", "EF": "F", "EFF": "F",
  "G": "G", "GEE": "G", "JEE": "G",
  "H": "H", "AITCH": "H", "HAITCH": "H", "AYTCH": "H", "ATCH": "H",
  "J": "J", "JAY": "J",
  "K": "K", "KAY": "K", "OK": "K", "OKAY": "K",
  "L": "L", "EL": "L", "ELL": "L",
  "M": "M", "EM": "M",
  "N": "N", "EN": "N",
  "P": "P", "PEE": "P", "PE": "P",
  "R": "R", "AR": "R", "ARE": "R", "ARR": "R",
  "S": "S", "ES": "S", "ESS": "S",
  "T": "T", "TEE": "T", "TEA": "T", "TI": "T",
  "U": "U", "YOU": "U", "EW": "U", "UE": "U",
  "V": "V", "VEE": "V",
  "W": "W", "DOUBLEYOU": "W", "DOUBLEU": "W",
  "X": "X", "EX": "X", "EKS": "X",
  "Y": "Y", "WHY": "Y", "WAI": "Y", "WYE": "Y",
  "Z": "Z", "ZEE": "Z", "ZED": "Z",

  // Numbers
  "0": "0", "ZERO": "0", "OH": "0", "NIL": "0", "NOUGHT": "0", "O": "0",
  "1": "1", "ONE": "1", "WON": "1", "I": "1", "EYE": "1",
  "2": "2", "TWO": "2", "TO": "2", "TOO": "2",
  "3": "3", "THREE": "3", "TREE": "3",
  "4": "4", "FOUR": "4", "FOR": "4", "FORE": "4",
  "5": "5", "FIVE": "5",
  "6": "6", "SIX": "6",
  "7": "7", "SEVEN": "7",
  "8": "8", "EIGHT": "8", "ATE": "8",
  "9": "9", "NINE": "9", "NINER": "9",

  // NATO phonetic (still works for those who use it)
  "ALPHA": "A", "BRAVO": "B", "CHARLIE": "C", "DELTA": "D",
  "ECHO": "E", "FOXTROT": "F", "GOLF": "G", "HOTEL": "H",
  "INDIA": "1", "JULIET": "J", "JULIETT": "J", "KILO": "K", "LIMA": "L",
  "MIKE": "M", "NOVEMBER": "N", "OSCAR": "0", "PAPA": "P",
  "QUEBEC": "0", "ROMEO": "R", "SIERRA": "S", "TANGO": "T",
  "UNIFORM": "U", "VICTOR": "V", "WHISKEY": "W", "WHISKY": "W",
  "XRAY": "X", "YANKEE": "Y", "ZULU": "Z",
};

// VIN spec excludes letters I, O, Q (visual confusion with 1, 0, 0).
// So I→1, O→0, Q→0 substitutions baked into the map above.

function normalizeVinTranscript(text: string): string {
  if (!text) return "";
  const cleaned = text.toUpperCase().replace(/[.,!?;:'"()]/g, "");
  const tokens = cleaned.split(/[\s\-/]+/).filter((t) => t.length > 0);

  let result = "";
  for (const token of tokens) {
    if (TOKEN_MAP[token]) {
      result += TOKEN_MAP[token];
    } else if (token.length === 1 && /[A-Z0-9]/.test(token)) {
      result += token;
    } else if (/^\d+$/.test(token)) {
      result += token; // multi-digit numbers
    } else if (/^[A-Z0-9]+$/.test(token)) {
      result += token; // alphanumeric blob
    }
  }
  // Final sanity: any I/O/Q that slipped through
  result = result.replace(/I/g, "1").replace(/O/g, "0").replace(/Q/g, "0");
  return result.slice(0, 17);
}

export default function VinEntryPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [vin, setVin] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMsg("");
    setRawTranscript("");
    audioChunksRef.current = [];

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setStatus("error");
      setErrorMsg("Microphone not available");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
      let mimeType = "";
      for (const m of mimeTypes) {
        if (m === "" || MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
      }
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        cleanupStream();
        if (audioChunksRef.current.length === 0) {
          setStatus("idle");
          return;
        }
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (audioBlob.size < 1000) {
          setStatus("idle");
          return;
        }

        setStatus("transcribing");
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "vin.webm");

          const response = await fetch("/api/transcribe", { method: "POST", body: formData });
          const result = (await response.json()) as { text?: string; error?: string };

          if (!response.ok || result.error) {
            setStatus("error");
            setErrorMsg(result.error || "Transcription failed");
            return;
          }

          const transcript = (result.text || "").trim();
          setRawTranscript(transcript);
          setVin(normalizeVinTranscript(transcript));
          setStatus("idle");
        } catch (e) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : "Network error");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err) {
      setStatus("error");
      const e = err as { name?: string };
      setErrorMsg(e.name === "NotAllowedError" ? "Microphone permission denied" : "Could not start microphone");
    }
  }, [cleanupStream]);

  const toggleRecording = useCallback(() => {
    if (status === "recording") stopRecording();
    else if (status === "idle" || status === "error") startRecording();
  }, [status, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  const handleVinChange = (newVin: string) => {
    setVin(newVin.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17));
  };

  const decodeVin = useCallback(async () => {
    if (!isValidVinFormat(vin)) {
      setErrorMsg("VIN must be exactly 17 characters (A-Z, 0-9, no I/O/Q)");
      return;
    }
    setStatus("decoding");
    setErrorMsg("");

    try {
      const response = await fetch("/api/decode-vin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin }),
      });
      const result = (await response.json()) as {
        success: boolean;
        make?: string; model?: string; year?: string; bodyType?: string;
        country?: string; confidence?: string; details?: VehicleDetails; error?: string;
      };
      if (!response.ok || !result.success) {
        setStatus("error");
        setErrorMsg(result.error || "VIN decode failed");
        return;
      }

      const parsed: ParsedDisc = {
        make: (result.make || "").toUpperCase(),
        model: result.model || "",
        year: result.year || vinToYear(vin),
        vin,
        registrationNumber: "",
        colour: "",
        bodyType: result.bodyType || "",
        raw: "[VIN_VOICE]",
        details: result.details,
      };

      try {
        sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(parsed));
        sessionStorage.setItem(STORAGE_KEY_METHOD, `vin-voice:${result.confidence || "?"}`);
      } catch {}

      setStatus("decoded");
      setTimeout(() => router.push("/assessments/new/vehicle"), 500);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }, [vin, router]);

  const skipToManual = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY_PARSED);
    router.push("/assessments/new/vehicle?manual=1");
  }, [router]);

  const clearAll = useCallback(() => {
    setVin(""); setRawTranscript(""); setErrorMsg("");
  }, []);

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
          Read each character. Tap stop when done. Auto-cleans into 17 valid VIN characters.
        </p>

        <div className="flex flex-col items-center mb-8">
          <button
            onClick={toggleRecording}
            disabled={status === "transcribing" || status === "decoding"}
            className={`haptic-tap w-28 h-28 rounded-full flex items-center justify-center transition-all ${
              status === "recording" ? "bg-red-500/20 border-2 border-red-500 animate-pulse"
              : status === "transcribing" || status === "decoding" ? "bg-gold/10 border-2 border-gold/30 opacity-60"
              : "bg-gold/15 border-2 border-gold hover:bg-gold/25"
            }`}
            aria-label={status === "recording" ? "Stop recording" : "Start recording"}
          >
            {status === "recording" ? (
              <svg width="40" height="40" viewBox="0 0 24 24" fill="#EF4444">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : status === "transcribing" || status === "decoding" ? (
              <div className="w-10 h-10 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
            ) : (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
          <div className="mt-4 text-xs font-mono uppercase tracking-wider text-center">
            {status === "recording" && <span className="text-red-400">● Recording — tap to stop</span>}
            {status === "transcribing" && <span className="text-gold">Transcribing</span>}
            {status === "decoding" && <span className="text-gold">Decoding VIN</span>}
            {status === "decoded" && <span className="text-emerald-400">✓ Vehicle identified</span>}
            {(status === "idle" || status === "error") && (
              <span className="text-white/40">Tap to speak the VIN</span>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">VIN</div>
            <div className="flex items-center gap-2">
              {(vin || rawTranscript) && status !== "decoding" && status !== "transcribing" && (
                <button onClick={clearAll} className="text-[10px] text-white/40 hover:text-white/70 underline">Clear</button>
              )}
              <div className={`text-[10px] font-mono uppercase tracking-wider ${
                isValid ? "text-emerald-400" : charsRemaining > 0 ? "text-white/40" : "text-amber-400"
              }`}>
                {vin.length}/17
              </div>
            </div>
          </div>
          <input
            type="text"
            value={vin}
            onChange={(e) => handleVinChange(e.target.value)}
            className="w-full bg-transparent border-none outline-none font-mono text-lg text-white tracking-wider"
            autoCorrect="off"
            autoCapitalize="characters"
            maxLength={17}
          />
          {rawTranscript && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="text-[9px] font-mono uppercase tracking-wider text-white/30">You said</div>
              <div className="text-xs text-white/50 italic">&ldquo;{rawTranscript}&rdquo;</div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        {!rawTranscript && status !== "recording" && (
          <div className="bg-surface/50 border border-border/50 rounded-xl p-3 mb-4 text-xs text-white/50">
            <div className="font-mono uppercase tracking-wider text-white/40 mb-1 text-[9px]">How to speak the VIN</div>
            <div className="text-white/70 mb-2">Just read each character one at a time:</div>
            <div className="font-mono text-white/80 leading-relaxed">
              &ldquo;K — M — H — B — T — five — one — D — R — six — U — five — four — seven — four — zero — two&rdquo;
            </div>
            <div className="text-white/40 mt-2 text-[11px] leading-relaxed">
              Pause briefly between characters.
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-4 border-t border-border bg-bg safe-bottom">
        <div className="max-w-md mx-auto flex flex-col gap-2">
          <button
            onClick={decodeVin}
            disabled={!isValid || status === "decoding"}
            className="haptic-tap w-full bg-gold text-black font-semibold py-3.5 rounded-xl text-base disabled:opacity-40"
          >
            {status === "decoding" ? "Decoding..." : "Look up vehicle"}
          </button>
          <button
            onClick={skipToManual}
            className="haptic-tap w-full border border-border text-white/70 py-2.5 rounded-xl text-xs"
          >
            Enter all details manually
          </button>
        </div>
      </div>
    </div>
  );
}
