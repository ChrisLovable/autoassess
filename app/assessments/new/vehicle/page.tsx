"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { vinToYear, type ParsedDisc } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_METHOD = "autoassess:parseMethod";

type FormData = {
  make: string;
  model: string;
  year: string;
  vin: string;
  registrationNumber: string;
  colour: string;
  bodyType: string;
};

// ============================================================
// VoiceField — voice-enabled input with inline mic button
// ============================================================
function VoiceField({
  label,
  value,
  onChange,
  uppercase = false,
  monospace = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  uppercase?: boolean;
  monospace?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [err, setErr] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setErr("");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
      let mime = "";
      for (const m of mimes) {
        if (m === "" || MediaRecorder.isTypeSupported(m)) { mime = m; break; }
      }
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        cleanup();
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "field.webm");
          const r = await fetch("/api/transcribe", { method: "POST", body: fd });
          const j = (await r.json()) as { text?: string; error?: string };
          if (!r.ok || j.error) { setErr(j.error || "Transcription failed"); }
          else {
            let t = (j.text || "").trim().replace(/[.,!?;:]$/, "");
            if (uppercase) t = t.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
            onChange(t);
          }
        } catch (e) {
          setErr(e instanceof Error ? e.message : "Network error");
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (e) {
      const err = e as { name?: string };
      setErr(err.name === "NotAllowedError" ? "Microphone permission denied" : "Could not start mic");
    }
  }, [cleanup, onChange, uppercase]);

  const toggle = () => (recording ? stop() : start());

  useEffect(() => () => { if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop(); cleanup(); }, [cleanup]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-mono uppercase tracking-wider text-white/40">{label}</label>
        {err && <span className="text-[9px] text-red-400">{err}</span>}
      </div>
      <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3 py-2.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
          className={`flex-1 bg-transparent outline-none text-white text-base ${monospace ? "font-mono tracking-wider" : ""}`}
          autoCorrect="off"
          autoCapitalize={uppercase ? "characters" : "off"}
        />
        <button
          onClick={toggle}
          disabled={transcribing}
          className={`haptic-tap shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
            recording ? "bg-red-500/20 border border-red-500 animate-pulse"
            : transcribing ? "bg-gold/10 opacity-60"
            : "bg-gold/15 border border-gold/30 hover:bg-gold/25"
          }`}
        >
          {recording ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#EF4444"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          ) : transcribing ? (
            <div className="w-4 h-4 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
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
// Main vehicle confirmation page
// ============================================================
function VehicleContent() {
  const router = useRouter();
  const params = useSearchParams();
  const isManual = params.get("manual") === "1";

  const [parsed, setParsed] = useState<ParsedDisc | null>(null);
  const [method, setMethod] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormData>({
    make: "",
    model: "",
    year: "",
    vin: "",
    registrationNumber: "",
    colour: "",
    bodyType: "",
  });

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_PARSED);
      const storedMethod = sessionStorage.getItem(STORAGE_KEY_METHOD) || "";
      setMethod(storedMethod);
      if (stored) {
        const p = JSON.parse(stored) as ParsedDisc;
        setParsed(p);
        setForm({
          make: p.make || "",
          model: p.model || "",
          year: p.year || (p.vin ? vinToYear(p.vin) : ""),
          vin: p.vin || "",
          registrationNumber: p.registrationNumber || "",
          colour: p.colour || "",
          bodyType: p.bodyType || "",
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleConfirm = () => {
    const cleaned: ParsedDisc = {
      make: form.make.trim().toUpperCase(),
      model: form.model.trim(),
      year: form.year.trim() || (form.vin ? vinToYear(form.vin) : ""),
      vin: form.vin.trim().toUpperCase(),
      registrationNumber: form.registrationNumber.trim().toUpperCase(),
      colour: form.colour.trim(),
      bodyType: form.bodyType.trim(),
      raw: parsed?.raw || "[MANUAL]",
    };
    try {
      sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(cleaned));
    } catch {}
    router.push("/assessments/new/damage");
  };

  const hasRequired = form.vin.length === 17 && form.registrationNumber.length > 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top">
        <button onClick={() => router.back()} className="haptic-tap text-white/60 hover:text-white text-sm">
          ← Back
        </button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          Step 2 of 5 · Vehicle
        </div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full overflow-y-auto">
        <div className="text-[10px] font-mono uppercase tracking-wider text-gold mb-2">
          Confirm vehicle details
        </div>
        <h1 className="font-display text-2xl font-bold mb-1">Vehicle</h1>
        <p className="text-sm text-white/60 mb-5">
          Tap any field&apos;s mic to voice-fill. Tap the field to type.
        </p>

        {/* Status banner */}
        {parsed ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-4 flex items-start gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <div className="text-xs text-emerald-300/90">
              <div className="font-semibold mb-0.5">Decoded from {method.includes("voice") ? "voice VIN" : "disc"}</div>
              <div className="text-emerald-300/60">Empty fields = data not available. Voice or type to fill.</div>
            </div>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 text-xs text-amber-300">
            {isManual ? "Manual entry mode" : "No data — fill in details"}
          </div>
        )}

        <div className="space-y-3">
          <VoiceField label="Make" value={form.make} onChange={(v) => updateField("make", v.toUpperCase())} uppercase />
          <VoiceField label="Model" value={form.model} onChange={(v) => updateField("model", v)} />
          <VoiceField label="Body type" value={form.bodyType} onChange={(v) => updateField("bodyType", v)} />

          <div className="grid grid-cols-2 gap-3">
            <VoiceField label="Year" value={form.year} onChange={(v) => updateField("year", v.replace(/\D/g, "").slice(0, 4))} monospace />
            <VoiceField label="Colour" value={form.colour} onChange={(v) => updateField("colour", v)} />
          </div>

          <VoiceField label="Registration" value={form.registrationNumber} onChange={(v) => updateField("registrationNumber", v.toUpperCase())} uppercase monospace />
          <VoiceField label="VIN" value={form.vin} onChange={(v) => updateField("vin", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17))} uppercase monospace />
        </div>
      </div>

      <div className="px-4 py-4 border-t border-border bg-bg safe-bottom">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleConfirm}
            disabled={!hasRequired}
            className="haptic-tap w-full bg-gold text-black font-semibold py-3.5 rounded-xl text-base disabled:opacity-40"
          >
            Confirm &amp; continue →
          </button>
          <div className="text-center text-[10px] font-mono uppercase tracking-wider text-white/30 mt-2">
            VIN + registration required
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VehiclePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-gold/30 border-t-gold animate-spin" /></div>}>
      <VehicleContent />
    </Suspense>
  );
}
