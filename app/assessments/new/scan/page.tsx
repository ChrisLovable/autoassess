"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from "@zxing/library";
import { parseSADisc, type ParsedDisc, type VehicleDetails } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_METHOD = "autoassess:parseMethod";

type State =
  | "requesting"     // asking for camera permission
  | "scanning"       // live camera, looking for PDF417
  | "decoding"       // PDF417 found, parsing
  | "enriching"      // calling NHTSA for full details
  | "decoded"        // success, navigating
  | "error";         // camera failed

type TorchTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

// Minimum brightness threshold for "too dark" warning (0-255)
const DARK_THRESHOLD = 45;
// Maximum brightness threshold for "too bright" warning
const BRIGHT_THRESHOLD = 230;
// Show fallback option after this many seconds
const FALLBACK_AFTER_SECONDS = 10;

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const decodedRef = useRef<boolean>(false);

  const [state, setState] = useState<State>("requesting");
  const [hint, setHint] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [scanElapsed, setScanElapsed] = useState(0);

  // ============================================================
  // Cleanup
  // ============================================================
  const cleanup = useCallback(() => {
    if (readerRef.current) {
      try { readerRef.current.reset(); } catch {}
      readerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // ============================================================
  // Handle PDF417 decode success â†’ enrich via NHTSA â†’ navigate
  // ============================================================
  const handleDecode = useCallback(async (rawText: string) => {
    if (decodedRef.current) return;

    const parsed = parseSADisc(rawText);
    if (!parsed) {
      // Got a PDF417 but it's not an SA disc â€” keep scanning
      setHint("Not a SA licence disc â€” try again");
      setTimeout(() => setHint(""), 2000);
      return;
    }

    decodedRef.current = true;
    cleanup();
    setState("enriching");

    // Enrich via NHTSA
    let details: VehicleDetails | undefined;
    let enrichedBodyType = parsed.bodyType;

    try {
      const resp = await fetch("/api/decode-vin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin: parsed.vin }),
      });
      if (resp.ok) {
        const r = await resp.json() as {
          success: boolean;
          bodyType?: string;
          details?: VehicleDetails;
        };
        if (r.success) {
          details = r.details;
          // Disc data wins for body type if it had one, NHTSA fills gap
          enrichedBodyType = parsed.bodyType || r.bodyType || "";
        }
      }
    } catch {
      // NHTSA failed â€” proceed with disc data only
    }

    const merged: ParsedDisc = {
      ...parsed,
      bodyType: enrichedBodyType,
      details,
    };

    try {
      sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(merged));
      sessionStorage.setItem(STORAGE_KEY_METHOD, details ? "live-scan+nhtsa" : "live-scan");
    } catch {}

    setState("decoded");
    setTimeout(() => router.push("/assessments/new/vehicle"), 500);
  }, [cleanup, router]);

  // ============================================================
  // Start camera + scanner
  // ============================================================
  const startScanning = useCallback(async () => {
    setErrorMsg("");
    decodedRef.current = false;
    setState("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;

      // Check torch support
      const track = stream.getVideoTracks()[0] as TorchTrack;
      const caps = track.getCapabilities?.();
      if (caps && "torch" in caps) setTorchAvailable(true);

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Setup PDF417-only decoder
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      startTimeRef.current = Date.now();
      setState("scanning");

      // Continuous scan on the existing video element
      reader.decodeFromStream(stream, videoRef.current, (result) => {
        if (result) {
          const text = result.getText();
          handleDecode(text);
        }
      });
    } catch (err) {
      setState("error");
      const e = err as { name?: string };
      setErrorMsg(
        e.name === "NotAllowedError" ? "Camera permission denied. Enable in browser settings."
        : e.name === "NotFoundError" ? "No camera found on this device"
        : e.name === "NotReadableError" ? "Camera in use by another app"
        : "Could not start camera"
      );
    }
  }, [handleDecode]);

  // ============================================================
  // Torch toggle
  // ============================================================
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet & { torch?: boolean }],
      });
      setTorchOn(!torchOn);
    } catch {
      // Torch not actually supported despite capability claim
    }
  }, [torchOn]);

  // ============================================================
  // Brightness monitoring (every 500ms while scanning)
  // ============================================================
  useEffect(() => {
    if (state !== "scanning") return;

    const interval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      if (video.readyState < 2 || video.videoWidth === 0) return;

      const canvas = canvasRef.current;
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Sample center horizontal strip (where the barcode guide is)
      const sampleW = Math.floor(canvas.width * 0.6);
      const sampleH = Math.floor(canvas.height * 0.25);
      const sx = Math.floor((canvas.width - sampleW) / 2);
      const sy = Math.floor((canvas.height - sampleH) / 2);
      const imageData = ctx.getImageData(sx, sy, sampleW, sampleH);
      const data = imageData.data;

      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      const brightness = sum / (data.length / 4);

      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setScanElapsed(elapsed);

      if (brightness < DARK_THRESHOLD) {
        setHint(torchAvailable ? "Too dark â€” tap torch" : "Too dark â€” find more light");
      } else if (brightness > BRIGHT_THRESHOLD) {
        setHint("Too bright â€” move from direct light/glare");
      } else if (elapsed > 6) {
        setHint("Move closer Â· fill the box Â· hold steady");
      } else if (elapsed > 3) {
        setHint("Align disc barcode in the box");
      } else {
        setHint("Looking for barcode...");
      }
    }, 500);

    return () => clearInterval(interval);
  }, [state, torchAvailable]);

  // ============================================================
  // Lifecycle
  // ============================================================
  useEffect(() => {
    startScanning();
    return cleanup;
  }, [startScanning, cleanup]);

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="min-h-screen bg-black text-white flex flex-col relative overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent safe-top">
        <button
          onClick={() => { cleanup(); router.back(); }}
          className="haptic-tap w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="font-mono text-[10px] uppercase tracking-wider text-white/70 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
          Disc Scan Â· PDF417
        </div>
        {torchAvailable ? (
          <button
            onClick={toggleTorch}
            className={`haptic-tap w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
              torchOn ? "bg-gold text-black" : "bg-black/40 text-white"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={torchOn ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </button>
        ) : (
          <div className="w-10 h-10" />
        )}
      </div>

      {/* Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* PDF417 Guide Overlay (3:1 aspect ratio for wide barcode strip) */}
      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
        <div
          className="relative"
          style={{ width: "85%", aspectRatio: "3 / 1", maxWidth: "500px" }}
        >
          <div className="absolute inset-0 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />

          {/* Corner brackets */}
          <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-[3px] border-l-[3px] border-gold rounded-tl-lg" />
          <div className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-[3px] border-r-[3px] border-gold rounded-tr-lg" />
          <div className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-[3px] border-l-[3px] border-gold rounded-bl-lg" />
          <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-[3px] border-r-[3px] border-gold rounded-br-lg" />

          {/* Scanning sweep */}
          {state === "scanning" && (
            <div className="absolute inset-x-2 top-1/2 h-px bg-gradient-to-r from-transparent via-gold to-transparent animate-pulse" />
          )}
        </div>
      </div>

      {/* Status pill (above the guide) */}
      <div className="absolute z-20 left-0 right-0 top-1/2 -translate-y-[calc(50%+90px)] pointer-events-none">
        <div className="text-center px-4">
          {state === "scanning" && (
            <div className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 border border-white/10">
              <div className="w-2 h-2 rounded-full bg-gold animate-pulse" />
              <div className="text-sm text-white">{hint}</div>
            </div>
          )}
          {state === "enriching" && (
            <div className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 border border-gold/30">
              <div className="w-3 h-3 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
              <div className="text-sm text-gold">Looking up vehicle details...</div>
            </div>
          )}
          {state === "decoded" && (
            <div className="inline-flex items-center gap-2 bg-emerald-500/20 backdrop-blur-sm border border-emerald-500 rounded-full px-4 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <div className="text-sm text-emerald-300 font-semibold">Disc decoded</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: instructions + fallback */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 py-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent safe-bottom">
        <div className="max-w-md mx-auto">
          {state === "scanning" && (
            <>
              <div className="text-center text-xs text-white/70 mb-3 leading-relaxed">
                Hold the phone 15â€“20cm from the barcode strip.<br />
                Fill the gold box with just the barcode.
              </div>
              {scanElapsed >= FALLBACK_AFTER_SECONDS && (
                <button
                  onClick={() => { cleanup(); router.push("/assessments/new/vin"); }}
                  className="haptic-tap w-full bg-black/60 backdrop-blur-sm border border-white/30 text-white py-3 rounded-xl text-sm font-medium"
                >
                  Trouble scanning? Switch to Voice VIN â†’
                </button>
              )}
            </>
          )}

          {state === "error" && (
            <div className="text-center">
              <div className="text-sm text-red-300 mb-3">{errorMsg}</div>
              <button
                onClick={startScanning}
                className="haptic-tap w-full bg-gold text-black font-semibold py-3 rounded-xl mb-2"
              >
                Try again
              </button>
              <button
                onClick={() => router.push("/assessments/new/vin")}
                className="haptic-tap w-full border border-white/30 text-white/80 py-2.5 rounded-xl text-sm"
              >
                Use Voice VIN instead
              </button>
            </div>
          )}

          {state === "requesting" && (
            <div className="text-center text-sm text-white/60">
              Requesting camera...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
