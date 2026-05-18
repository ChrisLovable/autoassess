"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { vinToYear, type ParsedDisc, type VehicleDetails } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_METHOD = "autoassess:parseMethod";

type Status = "idle" | "listening" | "decoding" | "decoded" | "error";

function isValidVinFormat(vin: string): boolean {
  return vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

// ============================================================
// Letter/number map - how people ACTUALLY say each character
// ============================================================
const TOKEN_MAP: Record<string, string> = {
  // Letters — natural English pronunciation
  "A": "A", "AY": "A", "AYE": "A",
  "B": "B", "BE": "B", "BEE": "B", "BEEN": "B",
  "C": "C", "SEE": "C", "SEA": "C", "CEE": "C",
  "D": "D", "DEE": "D",
  "E": "E", "EE": "E",
  "F": "F", "EF": "F", "EFF": "F",
  "G": "G", "GEE": "G", "JEE": "G",
  "H": "H", "AITCH": "H", "HAITCH": "H", "AYTCH": "H", "ATCH": "H",
  "I": "I", "EYE": "I",
  "J": "J", "JAY": "J",
  "K": "K", "KAY": "K", "OK": "K", "OKAY": "K",
  "L": "L", "EL": "L", "ELL": "L",
  "M": "M", "EM": "M",
  "N": "N", "EN": "N",
  "O": "O", "OWE": "O",
  "P": "P", "PEE": "P", "PE": "P",
  "Q": "Q", "CUE": "Q", "QUEUE": "Q", "QU": "Q",
  "R": "R", "AR": "R", "ARE": "R", "ARR": "R",
  "S": "S", "ES": "S", "ESS": "S",
  "T": "T", "TEE": "T", "TEA": "T", "TI": "T",
  "U": "U", "YOU": "U", "EW": "U", "UE": "U",
  "V": "V", "VEE": "V",
  "W": "W", "DOUBLEYOU": "W", "DOUBLEU": "W",
  "X": "X", "EX": "X", "EKS": "X",
  "Y": "Y", "WHY": "Y", "WAI": "Y", "WYE": "Y",
  "Z": "Z", "ZEE": "Z", "ZED": "Z",

  // Numbers — spoken as words
  "0": "0", "ZERO": "0", "OH": "0", "NIL": "0", "NOUGHT": "0", "O": "0",
  "1": "1", "ONE": "1", "WON": "1",
  "2": "2", "TWO": "2", "TO": "2", "TOO": "2",
  "3": "3", "THREE": "3", "TREE": "3",
  "4": "4", "FOUR": "4", "FOR": "4", "FORE": "4",
  "5": "5", "FIVE": "5",
  "6": "6", "SIX": "6",
  "7": "7", "SEVEN": "7",
  "8": "8", "EIGHT": "8", "ATE": "8",
  "9": "9", "NINE": "9", "NINER": "9",

  // NATO phonetic (still supported for those who use it)
  "ALPHA": "A", "BRAVO": "B", "CHARLIE": "C", "DELTA": "D",
  "ECHO": "E", "FOXTROT": "F", "GOLF": "G", "HOTEL": "H",
  "INDIA": "I", "JULIET": "J", "JULIETT": "J", "KILO": "K", "LIMA": "L",
  "MIKE": "M", "NOVEMBER": "N", "OSCAR": "O", "PAPA": "P",
  "QUEBEC": "Q", "ROMEO": "R", "SIERRA": "S", "TANGO": "T",
  "UNIFORM": "U", "VICTOR": "V", "WHISKEY": "W", "WHISKY": "W",
  "XRAY": "X", "YANKEE": "Y", "ZULU": "Z",
};

// Note: "O" is mapped to "0" because VINs cannot contain letter O (only digit 0).
// Same logic for I→1, Q→0 below.

function normalizeVinTranscript(text: string): string {
  if (!text) return "";

  // Uppercase, strip punctuation (keep spaces, dashes, slashes as separators)
  const cleaned = text.toUpperCase().replace(/[.,!?;:'"()]/g, "");

  // Split into tokens by whitespace, dashes, slashes, "X-RAY" etc.
  const tokens = cleaned.split(/[\s\-/]+/).filter((t) => t.length > 0);

  let result = "";
  for (const token of tokens) {
    if (TOKEN_MAP[token]) {
      // Known letter/number spelling → single char
      result += TOKEN_MAP[token];
    } else if (token.length === 1 && /[A-Z0-9]/.test(token)) {
      // Single character → use as is
      result += token;
    } else if (/^\d+$/.test(token)) {
      // Multi-digit number → keep all digits ("547" stays "547")
      result += token;
    } else if (/^[A-Z]+$/.test(token)) {
      // All-letter blob like "KMHB" → split into individual chars
      for (const char of token) {
        result += char;
      }
    } else if (/^[A-Z0-9]+$/.test(token)) {
      // Mixed alphanumeric blob like "KMH51" → keep as is
      result += token;
    }
    // else: unknown word, skip
  }

  // VIN spec: I, O, Q are not valid. People reading a VIN that has "1" might say "I",
  // and "0" might be heard as "O". Force these substitutions.
  result = result.replace(/I/g, "1").replace(/O/g, "0").replace(/Q/g, "0");

  return result.slice(0, 17);
}

// Web Speech API type stubs
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export default function VinEntryPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [vin, setVin] = useState("");
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [browserSupport, setBrowserSupport] = useState<boolean | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTextRef = useRef<string>("");
  const wantsToListenRef = useRef<boolean>(false);

  useEffect(() => { setBrowserSupport(!!getSpeechRecognitionCtor()); }, []);

  useEffect(() => {
    return () => {
      wantsToListenRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus("error");
      setErrorMsg("Speech recognition not supported in this browser");
      return;
    }

    setErrorMsg("");
    setInterimText("");
    setFinalText("");
    finalTextRef.current = "";

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      let newFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) newFinal += transcript + " ";
        else interim += transcript;
      }
      if (newFinal) {
        finalTextRef.current += newFinal;
        setFinalText(finalTextRef.current);
      }
      setInterimText(interim);

      const combined = finalTextRef.current + interim;
      const normalized = normalizeVinTranscript(combined);
      setVin(normalized);

      if (normalized.length >= 17) {
        wantsToListenRef.current = false;
        try { recognition.stop(); } catch {}
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setStatus("error");
      setErrorMsg(`Recognition error: ${event.error}`);
      wantsToListenRef.current = false;
    };

    recognition.onend = () => {
      if (wantsToListenRef.current) {
        try { recognition.start(); } catch { setStatus("idle"); }
      } else {
        setStatus("idle");
      }
    };

    recognitionRef.current = recognition;
    wantsToListenRef.current = true;
    try { recognition.start(); setStatus("listening"); }
    catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Could not start microphone");
    }
  }, []);

  const stopListening = useCallback(() => {
    wantsToListenRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (status === "listening") stopListening();
    else if (status === "idle" || status === "error") startListening();
  }, [status, startListening, stopListening]);

  const handleVinChange = (newVin: string) => {
    setVin(newVin.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17));
  };

  const decodeVin = useCallback(async () => {
    if (!isValidVinFormat(vin)) {
      setErrorMsg("VIN must be exactly 17 characters (A-Z, 0-9, no I/O/Q)");
      return;
    }
    stopListening();
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
        raw: "[VIN_REALTIME]",
        details: result.details,
      };

      try {
        sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(parsed));
        sessionStorage.setItem(STORAGE_KEY_METHOD, `vin-realtime:${result.confidence || "?"}`);
      } catch {}

      setStatus("decoded");
      setTimeout(() => router.push("/assessments/new/vehicle"), 500);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }, [vin, router, stopListening]);

  const skipToManual = useCallback(() => {
    stopListening();
    sessionStorage.removeItem(STORAGE_KEY_PARSED);
    router.push("/assessments/new/vehicle?manual=1");
  }, [router, stopListening]);

  const clearAll = useCallback(() => {
    setVin(""); setFinalText(""); setInterimText("");
    finalTextRef.current = ""; setErrorMsg("");
  }, []);

  const charsRemaining = 17 - vin.length;
  const isValid = isValidVinFormat(vin);

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top">
        <button onClick={() => { stopListening(); router.back(); }} className="haptic-tap text-white/60 hover:text-white text-sm">← Back</button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">Step 1 of 5 · VIN</div>
      </div>

      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="text-[10px] font-mono uppercase tracking-wider text-gold mb-2">Identify vehicle</div>
        <h1 className="font-display text-2xl font-bold mb-2">Speak the VIN</h1>
        <p className="text-sm text-white/60 mb-6">
          Read each character out loud. The VIN fills in as you speak.
        </p>

        {browserSupport === false && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 text-sm text-amber-300">
            Your browser doesn&apos;t support live speech recognition. Use Chrome (Android), Safari (iOS), or type manually below.
          </div>
        )}

        <div className="flex flex-col items-center mb-6">
          <button
            onClick={toggleListening}
            disabled={status === "decoding" || browserSupport === false}
            className={`haptic-tap w-28 h-28 rounded-full flex items-center justify-center transition-all ${
              status === "listening" ? "bg-red-500/20 border-2 border-red-500"
              : status === "decoding" ? "bg-gold/10 border-2 border-gold/30 opacity-60"
              : "bg-gold/15 border-2 border-gold hover:bg-gold/25"
            }`}
            aria-label={status === "listening" ? "Stop listening" : "Start listening"}
          >
            {status === "listening" ? (
              <div className="relative">
                <div className="absolute inset-0 -m-3 rounded-full border-2 border-red-500/40 animate-ping" />
                <svg width="40" height="40" viewBox="0 0 24 24" fill="#EF4444" className="relative">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </div>
            ) : status === "decoding" ? (
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
            {status === "listening" && (
              <span className="text-red-400 flex items-center justify-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                Live · tap to stop
              </span>
            )}
            {status === "decoding" && <span className="text-gold">Looking up vehicle</span>}
            {status === "decoded" && <span className="text-emerald-400">✓ Vehicle identified</span>}
            {(status === "idle" || status === "error") && (
              <span className="text-white/40">Tap to start live transcription</span>
            )}
          </div>
        </div>

        <div className={`bg-surface border rounded-xl p-4 mb-4 transition-colors ${
          status === "listening" ? "border-red-500/40" : "border-border"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">VIN</div>
            <div className="flex items-center gap-2">
              {(vin || finalText || interimText) && status !== "decoding" && (
                <button onClick={clearAll} className="text-[10px] text-white/40 hover:text-white/70 underline">Clear</button>
              )}
              <div className={`text-[10px] font-mono uppercase tracking-wider ${
                isValid ? "text-emerald-400" : charsRemaining > 0 ? "text-white/40" : "text-amber-400"
              }`}>{vin.length}/17</div>
            </div>
          </div>
          {status === "listening" ? (
            <div className="font-mono text-lg text-white tracking-[0.18em] py-1 min-h-[2rem]">
              {vin}
              <span className="inline-block w-2 h-5 bg-gold animate-pulse ml-1 align-middle" />
            </div>
          ) : (
            <input
              type="text" value={vin}
              onChange={(e) => handleVinChange(e.target.value)}
              className="w-full bg-transparent border-none outline-none font-mono text-lg text-white tracking-[0.18em]"
              autoCorrect="off" autoCapitalize="characters" maxLength={17}
            />
          )}
        </div>

        {(finalText || interimText) && (
          <div className="bg-surface/50 border border-border/50 rounded-xl p-3 mb-4">
            <div className="text-[9px] font-mono uppercase tracking-wider text-white/30 mb-1">Live transcript</div>
            <div className="text-xs leading-relaxed">
              <span className="text-white/80">{finalText}</span>
              <span className="text-white/40 italic">{interimText}</span>
              {status === "listening" && (
                <span className="inline-block w-1 h-3 bg-gold animate-pulse ml-1 align-middle" />
              )}
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        {!finalText && !interimText && status !== "listening" && (
          <div className="bg-surface/50 border border-border/50 rounded-xl p-3 mb-4 text-xs text-white/50">
            <div className="font-mono uppercase tracking-wider text-white/40 mb-1 text-[9px]">How to speak the VIN</div>
            <div className="text-white/70 mb-2">
              Just read each character one at a time:
            </div>
            <div className="font-mono text-white/80 leading-relaxed">
              &ldquo;K — M — H — B — T — five — one — D — R — six — U — five — four — seven — four — zero — two&rdquo;
            </div>
            <div className="text-white/40 mt-2 text-[11px] leading-relaxed">
              Pause briefly between characters. Numbers can be spoken as words (&ldquo;five&rdquo;) or digits (&ldquo;5&rdquo;).
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-4 border-t border-border bg-bg safe-bottom">
        <div className="max-w-md mx-auto flex flex-col gap-2">
          <button onClick={decodeVin} disabled={!isValid || status === "decoding"}
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
