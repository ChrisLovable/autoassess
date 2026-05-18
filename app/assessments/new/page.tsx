"use client";

import { useRouter } from "next/navigation";

export default function NewAssessmentPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top">
        <button onClick={() => router.back()} className="haptic-tap text-white/60 hover:text-white text-sm">
          ← Back
        </button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          Step 1 of 5 · Vehicle
        </div>
      </div>

      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full flex flex-col">
        <div className="text-[10px] font-mono uppercase tracking-wider text-gold mb-2">
          Identify vehicle
        </div>
        <h1 className="font-display text-3xl font-bold mb-3 leading-tight">
          How do you want to capture the vehicle?
        </h1>
        <p className="text-sm text-white/60 mb-8">
          All three methods auto-enrich via NHTSA VIN lookup. Pick the fastest for the situation in front of you.
        </p>

        <div className="space-y-3">
          {/* Primary: live scan */}
          <button
            onClick={() => router.push("/assessments/new/scan")}
            className="haptic-tap w-full bg-gold text-black p-5 rounded-2xl text-left transition-transform active:scale-[0.98]"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-black/15 flex items-center justify-center shrink-0">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 10.07 4h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 18.07 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-display font-bold text-lg leading-tight">Scan disc barcode</div>
                <div className="text-xs opacity-80 mt-1">Live camera · auto-fills 7+ fields · fastest</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-2 opacity-50">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </button>

          {/* Secondary: voice VIN */}
          <button
            onClick={() => router.push("/assessments/new/vin")}
            className="haptic-tap w-full bg-surface border border-border p-5 rounded-2xl text-left"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center shrink-0">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-display font-bold text-lg leading-tight">Voice VIN</div>
                <div className="text-xs text-white/60 mt-1">Disc damaged · behind glass · faded barcode</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-2 opacity-30">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </button>

          {/* Tertiary: manual */}
          <button
            onClick={() => router.push("/assessments/new/vehicle?manual=1")}
            className="haptic-tap w-full border border-border p-5 rounded-2xl text-left"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-display font-bold text-base text-white/80 leading-tight">Type manually</div>
                <div className="text-xs text-white/40 mt-1">No camera · no disc available</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-2 opacity-20">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
