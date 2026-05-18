'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ChevronLeftIcon, EditIcon } from '@/components/ui/Icons';
import { MOCK_PARSED_DISC, type ParsedDisc } from '@/lib/disc';

function VehicleDetailsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isManual = searchParams.get('manual') === '1';
  const [vehicle, setVehicle] = useState<ParsedDisc | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  useEffect(() => {
    // Load the captured disc image (set by the disc scanner)
    try {
      const img = sessionStorage.getItem('autoassess.disc.image');
      if (img) setCapturedImage(img);
    } catch {
      // ignore
    }

    if (isManual) {
      // Manual entry — show empty form
      setVehicle({
        controlNumber: null,
        licenceNumber: null,
        registrationNumber: null,
        vehicleDescription: null,
        make: null,
        model: null,
        vin: null,
        engineNumber: null,
        licenceExpiry: null,
        year: null,
        colour: null,
        raw: '',
        rawFields: [],
        confidence: 'low',
      });
    } else {
      // MOCK — in production this is replaced by:
      //   1. Run ZXing PDF417 decode on the captured image
      //   2. Pass the raw barcode string into parseSADisc()
      // For now, return mock data after a small delay to simulate processing.
      const t = setTimeout(() => setVehicle(MOCK_PARSED_DISC), 600);
      return () => clearTimeout(t);
    }
  }, [isManual]);

  return (
    <main className="min-h-screen max-w-md mx-auto pb-32 safe-top safe-bottom">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center haptic-tap"
          aria-label="Back"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/50">
          Step 2 of 5 — Vehicle details
        </div>
        <div className="w-10" />
      </div>

      {!vehicle ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-12 h-12 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
          <div className="mt-4 text-sm text-white/60 font-mono uppercase tracking-widest">
            Extracting disc data
          </div>
        </div>
      ) : (
        <div className="animate-fade-in">
          <div className="px-5">
            <div className="font-mono text-[10px] text-emerald-400 uppercase tracking-widest mb-1">
              {isManual ? 'Manual entry' : '✓ Identified from disc'}
            </div>
            <h1 className="font-display text-2xl tracking-tight leading-tight">
              {vehicle.make
                ? `${vehicle.make} ${vehicle.model ?? ''}`.trim()
                : 'New vehicle'}
            </h1>
            {vehicle.registrationNumber && (
              <div className="text-sm text-white/60 mt-1 font-mono">
                {vehicle.registrationNumber}
                {vehicle.colour && ` · ${vehicle.colour}`}
                {vehicle.year && ` · ${vehicle.year}`}
              </div>
            )}
          </div>

          {capturedImage && !isManual && (
            <div className="mx-5 mt-5 rounded-2xl overflow-hidden border border-border aspect-video bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={capturedImage}
                alt="Captured licence disc"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="mx-5 mt-5 bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="bg-surface-2 px-4 py-2.5 border-b border-border flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest font-mono text-white/40">
                {isManual ? 'Enter details' : 'Disc data'}
              </div>
              <button className="text-[10px] uppercase tracking-widest font-mono text-gold haptic-tap flex items-center gap-1">
                <EditIcon className="w-3 h-3" />
                Edit
              </button>
            </div>
            <dl className="divide-y divide-border">
              {(
                [
                  ['Registration', vehicle.registrationNumber],
                  ['Make', vehicle.make],
                  ['Model', vehicle.model],
                  ['Year', vehicle.year?.toString() ?? null],
                  ['Colour', vehicle.colour],
                  ['VIN', vehicle.vin],
                  ['Engine number', vehicle.engineNumber],
                  ['Description', vehicle.vehicleDescription],
                  ['Licence expiry', vehicle.licenceExpiry],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="px-4 py-3 flex items-baseline justify-between gap-3"
                >
                  <dt className="text-xs text-white/50 shrink-0">{label}</dt>
                  <dd className="font-mono text-sm text-right truncate">
                    {value ?? <span className="text-white/30">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {!isManual && vehicle.confidence !== 'high' && (
            <div className="mx-5 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
              <div className="text-xs text-amber-300 leading-relaxed">
                Some disc fields could not be read clearly. Tap Edit above to
                review and correct before continuing.
              </div>
            </div>
          )}

          <div
            className="fixed bottom-0 inset-x-0 max-w-md mx-auto p-5 pt-8"
            style={{
              background:
                'linear-gradient(to top, #0A0A0A, rgba(10,10,10,0.95), transparent)',
            }}
          >
            <button
              onClick={() => router.push('/assessments/new/incident')}
              className="w-full bg-gold text-black rounded-2xl py-4 font-medium haptic-tap"
            >
              Confirm &amp; continue
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function VehicleDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-screen">
          <div className="w-12 h-12 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
        </div>
      }
    >
      <VehicleDetailsContent />
    </Suspense>
  );
}
