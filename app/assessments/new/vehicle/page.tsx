"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ParsedDisc } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_IMAGE = "autoassess:lastDiscImage";

function MonoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-1">
        {label}
      </div>
      <div className="font-mono text-sm text-white break-all">
        {value || <span className="text-white/30">â€”</span>}
      </div>
    </div>
  );
}

export default function VehiclePage() {
  const router = useRouter();
  const params = useSearchParams();
  const isManual = params.get("manual") === "1";

  const [parsed, setParsed] = useState<ParsedDisc | null>(null);
  const [discImage, setDiscImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY_PARSED);
      if (stored) {
        setParsed(JSON.parse(stored) as ParsedDisc);
      }
      const img = sessionStorage.getItem(STORAGE_KEY_IMAGE);
      if (img) setDiscImage(img);
    } catch {
      // Storage unavailable â€” leave as null
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center text-white/40 font-mono text-xs uppercase tracking-wider">
        Loading...
      </div>
    );
  }

  // If no parsed data and not manual mode â†’ decode failed silently somewhere
  // Show empty form so user can fill in by hand
  const data: Partial<ParsedDisc> = parsed || {};

  return (
    <div className="min-h-screen bg-bg text-white pb-32">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 safe-top">
        <button
          onClick={() => router.back()}
          className="haptic-tap text-white/60 hover:text-white text-sm"
        >
          â† Back
        </button>
        <div className="flex-1" />
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/40">
          Step 2 of 5 Â· Confirm vehicle
        </div>
      </div>

      <div className="px-4 pt-6 max-w-md mx-auto">
        {/* Status banner */}
        {parsed ? (
          <div className="mb-6 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3">
                <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-display font-semibold">Disc read successfully</div>
              <div className="text-xs text-white/60 mt-0.5">
                Confirm details below before continuing
              </div>
            </div>
          </div>
        ) : isManual ? (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5">
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-display font-semibold">Manual entry</div>
              <div className="text-xs text-white/60 mt-0.5">
                Fill in vehicle details by hand
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-display font-semibold">No disc data found</div>
              <div className="text-xs text-white/60 mt-0.5">
                Please go back and rescan or use manual entry
              </div>
            </div>
          </div>
        )}

        {/* Primary identifiers */}
        <div className="bg-surface border border-border rounded-2xl p-5 mb-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-gold mb-3">
            Vehicle
          </div>
          <div className="font-display text-2xl font-bold leading-tight">
            {data.make || "â€”"}
          </div>
          <div className="font-display text-base text-white/70 mt-1">
            {data.model || "â€”"}
          </div>
        </div>

        {/* Reg & VIN */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <MonoField label="Registration" value={data.registrationNumber || ""} />
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <MonoField label="Colour" value={data.colour || ""} />
          </div>
        </div>

        {/* VIN */}
        <div className="bg-surface border border-border rounded-xl p-4 mb-4">
          <MonoField label="VIN / Chassis" value={data.vin || ""} />
        </div>

        {/* Other */}
        <div className="bg-surface border border-border rounded-xl divide-y divide-border">
          <div className="p-4">
            <MonoField label="Engine number" value={data.engineNumber || ""} />
          </div>
          <div className="p-4">
            <MonoField label="Body type" value={data.description || ""} />
          </div>
          <div className="p-4">
            <MonoField label="Licence expires" value={data.expiryDate || ""} />
          </div>
        </div>

        {/* Disc photo thumbnail (if we have it) */}
        {discImage && (
          <div className="mt-4 bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 mb-3">
              Captured disc
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={discImage}
              alt="Captured licence disc"
              className="w-full rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 inset-x-0 bg-bg/95 backdrop-blur-sm border-t border-border safe-bottom">
        <div className="px-4 py-4 max-w-md mx-auto flex flex-col gap-2">
          <button
            onClick={() => {
              // TODO: navigate to next step (incident context) once built
              alert("Next step (incident context) coming in v0.4");
            }}
            className="haptic-tap w-full bg-gold text-black font-semibold py-3.5 rounded-xl text-base"
          >
            Confirm &amp; continue
          </button>
          <button
            onClick={() => router.push("/assessments/new")}
            className="haptic-tap w-full border border-border text-white/70 py-3 rounded-xl text-sm"
          >
            Rescan disc
          </button>
        </div>
      </div>
    </div>
  );
}
