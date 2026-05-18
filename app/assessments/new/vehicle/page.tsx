"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { vinToYear, type ParsedDisc, type VehicleDetails } from "@/lib/disc";

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
// VoiceField (voice-enabled input with inline mic)
// ============================================================
function VoiceField({ label, value, onChange, uppercase = false, monospace = false }: {
  label: string; value: string; onChange: (v: string) => void;
  uppercase?: boolean; monospace?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [err, setErr] = useState("");
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (stream.current) { stream.current.getTracks().forEach((t) => t.stop()); stream.current = null; }
  }, []);

  const stop = useCallback(() => {
    if (mr.current && mr.current.state !== "inactive") mr.current.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setErr(""); chunks.current = [];
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
        if (chunks.current.length === 0) return;
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 1000) return;
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "field.webm");
          const resp = await fetch("/api/transcribe", { method: "POST", body: fd });
          const j = (await resp.json()) as { text?: string; error?: string };
          if (!resp.ok || j.error) setErr(j.error || "Transcription failed");
          else {
            let t = (j.text || "").trim().replace(/[.,!?;:]$/, "");
            if (uppercase) t = t.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
            onChange(t);
          }
        } catch (e) { setErr(e instanceof Error ? e.message : "Network error"); }
        finally { setTranscribing(false); }
      };
      mr.current = r;
      r.start();
      setRecording(true);
    } catch (e) {
      const err = e as { name?: string };
      setErr(err.name === "NotAllowedError" ? "Microphone permission denied" : "Could not start mic");
    }
  }, [cleanup, onChange, uppercase]);

  useEffect(() => () => { if (mr.current?.state === "recording") mr.current.stop(); cleanup(); }, [cleanup]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-mono uppercase tracking-wider text-white/40">{label}</label>
        {err && <span className="text-[9px] text-red-400">{err}</span>}
      </div>
      <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-3 py-2.5">
        <input
          type="text" value={value}
          onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
          className={`flex-1 bg-transparent outline-none text-white text-base ${monospace ? "font-mono tracking-wider" : ""}`}
          autoCorrect="off" autoCapitalize={uppercase ? "characters" : "off"}
        />
        <button
          onClick={() => (recording ? stop() : start())}
          disabled={transcribing}
          className={`haptic-tap shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
            recording ? "bg-red-500/20 border border-red-500 animate-pulse"
            : transcribing ? "bg-gold/10 opacity-60"
            : "bg-gold/15 border border-gold/30 hover:bg-gold/25"
          }`}
        >
          {recording ? <svg width="14" height="14" viewBox="0 0 24 24" fill="#EF4444"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            : transcribing ? <div className="w-4 h-4 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// DetailRow — small read-only key/value row for NHTSA data
// ============================================================
function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
      <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 shrink-0 pt-0.5">{label}</div>
      <div className="text-xs text-white text-right">{value}</div>
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
  const [details, setDetails] = useState<VehicleDetails | undefined>(undefined);
  const [method, setMethod] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const [form, setForm] = useState<FormData>({
    make: "", model: "", year: "", vin: "",
    registrationNumber: "", colour: "", bodyType: "",
  });

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_PARSED);
      const storedMethod = sessionStorage.getItem(STORAGE_KEY_METHOD) || "";
      setMethod(storedMethod);
      if (stored) {
        const p = JSON.parse(stored) as ParsedDisc;
        setParsed(p);
        setDetails(p.details);
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
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const updateField = (field: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

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
      details, // preserve full NHTSA details for quote generation
    };
    try { sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(cleaned)); } catch {}
    router.push("/assessments/new/damage");
  };

  const hasRequired = form.vin.length === 17 && form.registrationNumber.length > 0;

  if (loading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
    </div>;
  }

  // ADAS feature count (for the badge)
  const adasFeatures = [
    details?.forwardCollisionWarning, details?.laneDepartureWarning, details?.laneKeepSystem,
    details?.blindSpotMon, details?.backupCamera, details?.parkAssist,
    details?.adaptiveCruiseControl, details?.dynamicBrakeSupport,
  ].filter((v) => v && !/no$/i.test(v) && !/standard not avail/i.test(v));
  const hasAnyDetails = details && Object.values(details).some((v) => v);

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top">
        <button onClick={() => router.back()} className="haptic-tap text-white/60 hover:text-white text-sm">← Back</button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">Step 2 of 5 · Vehicle</div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full overflow-y-auto">
        <div className="text-[10px] font-mono uppercase tracking-wider text-gold mb-2">Confirm vehicle</div>
        <h1 className="font-display text-2xl font-bold mb-1">Vehicle</h1>
        <p className="text-sm text-white/60 mb-5">Tap mic to voice-fill, or tap the field to type.</p>

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

        <div className="space-y-3 mb-4">
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

        {/* Vehicle Features expandable card */}
        {hasAnyDetails && (
          <div className="bg-surface border border-border rounded-xl mb-4 overflow-hidden">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="haptic-tap w-full px-4 py-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gold/15 border border-gold/30 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold text-white">Vehicle features</div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                    {adasFeatures.length > 0 ? `${adasFeatures.length} ADAS features detected` : "From NHTSA"}
                  </div>
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showDetails ? "rotate-180" : ""}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showDetails && details && (
              <div className="px-4 pb-3 border-t border-border/50">
                {/* Identification */}
                {(details.trim || details.series || details.doors || details.vehicleType) && (
                  <div className="pt-3">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-gold mb-1">Identification</div>
                    <DetailRow label="Trim" value={details.trim} />
                    <DetailRow label="Series" value={details.series} />
                    <DetailRow label="Doors" value={details.doors} />
                    <DetailRow label="Vehicle type" value={details.vehicleType} />
                    <DetailRow label="Cab type" value={details.bodyCabType} />
                  </div>
                )}

                {/* Engine + drivetrain */}
                {(details.engineCylinders || details.engineDisplacementL || details.fuelTypePrimary || details.driveType) && (
                  <div className="pt-3">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-gold mb-1">Powertrain</div>
                    <DetailRow label="Cylinders" value={details.engineCylinders} />
                    <DetailRow label="Displacement" value={details.engineDisplacementL ? `${details.engineDisplacementL}L` : ""} />
                    <DetailRow label="HP" value={details.engineHP} />
                    <DetailRow label="Fuel" value={details.fuelTypePrimary} />
                    <DetailRow label="Fuel (2)" value={details.fuelTypeSecondary} />
                    <DetailRow label="Transmission" value={details.transmissionStyle ? `${details.transmissionStyle}${details.transmissionSpeeds ? ` ${details.transmissionSpeeds}-spd` : ""}` : ""} />
                    <DetailRow label="Drive" value={details.driveType} />
                    <DetailRow label="Valves" value={details.valveTrainDesign} />
                  </div>
                )}

                {/* ADAS / safety - the big one for panel beater quotes */}
                {(details.abs || details.forwardCollisionWarning || details.backupCamera || details.airBagLocFront) && (
                  <div className="pt-3">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-gold mb-1">Safety &amp; ADAS</div>
                    <DetailRow label="ABS" value={details.abs} />
                    <DetailRow label="ESC" value={details.esc} />
                    <DetailRow label="Traction control" value={details.tractionControl} />
                    <DetailRow label="TPMS" value={details.tpms} />
                    <DetailRow label="Airbags (front)" value={details.airBagLocFront} />
                    <DetailRow label="Airbags (side)" value={details.airBagLocSide} />
                    <DetailRow label="Airbags (curtain)" value={details.airBagLocCurtain} />
                    <DetailRow label="Airbags (knee)" value={details.airBagLocKnee} />
                    <DetailRow label="Forward collision" value={details.forwardCollisionWarning} />
                    <DetailRow label="Lane departure" value={details.laneDepartureWarning} />
                    <DetailRow label="Lane keep assist" value={details.laneKeepSystem} />
                    <DetailRow label="Blind spot" value={details.blindSpotMon} />
                    <DetailRow label="Backup camera" value={details.backupCamera} />
                    <DetailRow label="Park assist" value={details.parkAssist} />
                    <DetailRow label="Adaptive cruise" value={details.adaptiveCruiseControl} />
                    <DetailRow label="Pedestrian AEB" value={details.pedestrianAutomaticEmergencyBraking} />
                    <DetailRow label="DRL" value={details.daytimeRunningLight} />
                    <DetailRow label="Keyless ignition" value={details.keylessIgnition} />
                  </div>
                )}

                {/* Dimensions */}
                {(details.gvwr || details.curbWeightLB || details.wheelBaseIN) && (
                  <div className="pt-3">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-gold mb-1">Dimensions</div>
                    <DetailRow label="GVWR class" value={details.gvwr} />
                    <DetailRow label="Curb weight" value={details.curbWeightLB ? `${details.curbWeightLB} lb` : ""} />
                    <DetailRow label="Wheelbase" value={details.wheelBaseIN ? `${details.wheelBaseIN}″` : ""} />
                    <DetailRow label="Front wheel" value={details.wheelSizeFront} />
                    <DetailRow label="Rear wheel" value={details.wheelSizeRear} />
                    <DetailRow label="Bed length" value={details.bedLengthIN ? `${details.bedLengthIN}″` : ""} />
                    <DetailRow label="Bed type" value={details.bedType} />
                  </div>
                )}

                {/* Plant */}
                {(details.plantCountry || details.plantCity || details.manufacturer) && (
                  <div className="pt-3">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-gold mb-1">Manufacturing</div>
                    <DetailRow label="Country" value={details.plantCountry} />
                    <DetailRow label="State" value={details.plantState} />
                    <DetailRow label="City" value={details.plantCity} />
                    <DetailRow label="Plant" value={details.plantCompanyName} />
                    <DetailRow label="Manufacturer" value={details.manufacturer} />
                  </div>
                )}

                {/* EV */}
                {details.electrificationLevel && !/^combustion/i.test(details.electrificationLevel) && (
                  <div className="pt-3">
                    <div className="text-[9px] font-mono uppercase tracking-wider text-gold mb-1">Electric</div>
                    <DetailRow label="Type" value={details.electrificationLevel} />
                    <DetailRow label="Battery" value={details.batteryKWh ? `${details.batteryKWh} kWh` : ""} />
                    <DetailRow label="Charger" value={details.chargerLevel} />
                    <DetailRow label="Drive unit" value={details.evDriveUnit} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 py-4 border-t border-border bg-bg safe-bottom">
        <div className="max-w-md mx-auto">
          <button onClick={handleConfirm} disabled={!hasRequired} className="haptic-tap w-full bg-gold text-black font-semibold py-3.5 rounded-xl text-base disabled:opacity-40">
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
