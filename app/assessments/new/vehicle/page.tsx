"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { vinToYear, type ParsedDisc } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_IMAGE = "autoassess:lastDiscImage";
const STORAGE_KEY_FORM = "autoassess:vehicleForm";
const STORAGE_KEY_METHOD = "autoassess:parseMethod";

type FormData = {
  make: string;
  model: string;
  year: string;
  vin: string;
  registrationNumber: string;
  colour: string;
};

const EMPTY_FORM: FormData = {
  make: "",
  model: "",
  year: "",
  vin: "",
  registrationNumber: "",
  colour: "",
};

// ============================================================
// Voice-enabled field â€” MediaRecorder + ElevenLabs Scribe
// ============================================================

type VoiceFieldStatus = "idle" | "recording" | "processing" | "error";

function VoiceField({
  label,
  value,
  onChange,
  placeholder = "",
  uppercase = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  uppercase?: boolean;
}) {
  const [status, setStatus] = useState<VoiceFieldStatus>("idle");
  const [errMsg, setErrMsg] = useState<string>("");
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
    setErrMsg("");
    audioChunksRef.current = [];

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setStatus("error");
      setErrMsg("Microphone not available");
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
        if (m === "" || MediaRecorder.isTypeSupported(m)) {
          mimeType = m;
          break;
        }
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

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

        setStatus("processing");
        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          const response = await fetch("/api/transcribe", { method: "POST", body: formData });
          const result = (await response.json()) as { text?: string; error?: string };

          if (!response.ok || result.error) {
            setStatus("error");
            setErrMsg(result.error || "Transcription failed");
            setTimeout(() => setStatus("idle"), 2500);
            return;
          }

          const text = (result.text || "").trim();
          if (text) {
            const cleaned = uppercase
              ? text.toUpperCase().replace(/\s+/g, " ").trim()
              : text;
            onChange(value ? `${value} ${cleaned}` : cleaned);
          }
          setStatus("idle");
        } catch (e) {
          setStatus("error");
          setErrMsg(e instanceof Error ? e.message : "Network error");
          setTimeout(() => setStatus("idle"), 2500);
        }
      };

      recorder.onerror = () => {
        setStatus("error");
        setErrMsg("Recording error");
        cleanupStream();
        setTimeout(() => setStatus("idle"), 2500);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err) {
      setStatus("error");
      const e = err as { name?: string };
      setErrMsg(e.name === "NotAllowedError" ? "Microphone permission denied" : "Could not start microphone");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }, [cleanupStream, onChange, uppercase, value]);

  const toggle = useCallback(() => {
    if (status === "recording") stopRecording();
    else if (status === "idle") startRecording();
  }, [status, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 min-h-[14px]">
        <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">{label}</div>
        {status === "recording" && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <div className="text-[10px] font-mono uppercase tracking-wider text-red-400">Recording</div>
          </div>
        )}
        {status === "processing" && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full border border-gold/30 border-t-gold animate-spin" />
            <div className="text-[10px] font-mono uppercase tracking-wider text-gold">Transcribing</div>
          </div>
        )}
        {status === "error" && errMsg && (
          <div className="text-[10px] font-mono uppercase tracking-wider text-red-400 truncate ml-2">
            {errMsg}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none font-mono text-sm text-white placeholder:text-white/30"
          autoCorrect={uppercase ? "off" : "on"}
          autoCapitalize={uppercase ? "characters" : "sentences"}
        />
        <button
          onClick={toggle}
          type="button"
          disabled={status === "processing"}
          className={`haptic-tap flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            status === "recording"
              ? "bg-red-500/20 border border-red-500/50"
              : status === "processing"
              ? "bg-gold/10 border border-gold/30 opacity-50"
              : "bg-gold/10 border border-gold/30 hover:bg-gold/20"
          }`}
          aria-label={status === "recording" ? "Stop recording" : "Start voice input"}
        >
          {status === "recording" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#EF4444">
              <rect x="6" y="6" width="12" height="12" rx="1.5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Inner content
// ============================================================

function VehicleContent() {
  const router = useRouter();
  const params = useSearchParams();
  const isManual = params.get("manual") === "1";

  const [parsed, setParsed] = useState<ParsedDisc | null>(null);
  const [parseMethod, setParseMethod] = useState<string>("");
  const [discImage, setDiscImage] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_PARSED);
      if (stored) {
        const p = JSON.parse(stored) as ParsedDisc;
        setParsed(p);
        setForm({
          make: p.make || "",
          model: p.model || "",
          year: p.year || "",
          vin: p.vin || "",
          registrationNumber: p.registrationNumber || "",
          colour: p.colour || "",
        });
      } else {
        const existingForm = sessionStorage.getItem(STORAGE_KEY_FORM);
        if (existingForm) {
          setForm(JSON.parse(existingForm) as FormData);
        }
      }
      const method = sessionStorage.getItem(STORAGE_KEY_METHOD);
      if (method) setParseMethod(method);
      const img = sessionStorage.getItem(STORAGE_KEY_IMAGE);
      if (img) setDiscImage(img);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    try {
      sessionStorage.setItem(STORAGE_KEY_FORM, JSON.stringify(form));
    } catch {}
  }, [form, loading]);

  // Auto-decode year whenever VIN changes (if year is empty)
  useEffect(() => {
    if (loading) return;
    if (form.vin.length === 17 && !form.year) {
      const derived = vinToYear(form.vin);
      if (derived) {
        setForm((prev) => ({ ...prev, year: derived }));
      }
    }
  }, [form.vin, form.year, loading]);

  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center text-white/40 font-mono text-xs uppercase tracking-wider">
        Loading...
      </div>
    );
  }

  const methodLabel = parseMethod.startsWith("vision")
    ? "AI Vision"
    : parseMethod === "pdf417"
    ? "Barcode"
    : "";

  return (
    <div className="min-h-screen bg-bg text-white pb-36">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top sticky top-0 bg-bg/95 backdrop-blur-sm z-10">
        <button
          onClick={() => router.back()}
          className="haptic-tap text-white/60 hover:text-white text-sm"
        >
          â† Back
        </button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          Step 2 of 5 Â· Vehicle
        </div>
      </div>

      <div className="px-4 pt-6 max-w-md mx-auto">
        {parsed ? (
          <div className="mb-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3">
                <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-display font-semibold flex items-center gap-2">
                Disc read
                {methodLabel && (
                  <span className="text-[9px] font-mono uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded">
                    {methodLabel}
                  </span>
                )}
              </div>
              <div className="text-xs text-white/60 mt-0.5">
                Check details Â· tap mic to dictate
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5">
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-display font-semibold">
                {isManual ? "Manual entry" : "No disc data"}
              </div>
              <div className="text-xs text-white/60 mt-0.5">Type or tap mic to dictate</div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <VoiceField
            label="Make"
            value={form.make}
            onChange={(v) => updateField("make", v.toUpperCase())}
            uppercase
          />

          <VoiceField
            label="Model"
            value={form.model}
            onChange={(v) => updateField("model", v)}
          />

          <div className="grid grid-cols-2 gap-3">
            <VoiceField
              label="Year"
              value={form.year}
              onChange={(v) => updateField("year", v.replace(/\D/g, "").slice(0, 4))}
            />
            <VoiceField
              label="Colour"
              value={form.colour}
              onChange={(v) => updateField("colour", v)}
            />
          </div>

          <VoiceField
            label="Registration"
            value={form.registrationNumber}
            onChange={(v) => updateField("registrationNumber", v.toUpperCase())}
            uppercase
          />

          <VoiceField
            label="VIN / Chassis"
            value={form.vin}
            onChange={(v) => updateField("vin", v.toUpperCase().replace(/\s+/g, ""))}
            uppercase
          />
        </div>

        {discImage && (
          <div className="mt-5 bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-3">
              Captured disc
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={discImage} alt="Captured licence disc" className="w-full rounded-lg" />
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-bg/95 backdrop-blur-sm border-t border-border safe-bottom z-20">
        <div className="px-4 py-4 max-w-md mx-auto flex flex-col gap-2">
          <button
            onClick={() => alert("Next step (damage capture) coming in v0.4")}
            className="haptic-tap w-full bg-gold text-black font-semibold py-3.5 rounded-xl text-base disabled:opacity-40"
            disabled={!form.make && !form.registrationNumber && !form.vin}
          >
            Confirm &amp; continue
          </button>
          <button
            onClick={() => router.push("/assessments/new")}
            className="haptic-tap w-full border border-border text-white/70 py-2.5 rounded-xl text-xs"
          >
            Rescan disc
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center text-white/40 font-mono text-xs uppercase tracking-wider">
      Loading...
    </div>
  );
}

export default function VehiclePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VehicleContent />
    </Suspense>
  );
}
