"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type ParsedDisc, type VehicleDetails } from "@/lib/disc";

const STORAGE_KEY_PARSED = "autoassess:parsedDisc";
const STORAGE_KEY_METHOD = "autoassess:parseMethod";
const STORAGE_KEY_PHOTO = "autoassess:discPhoto";

type State =
  | "requesting"   // asking for camera permission
  | "live"         // camera streaming, ready to capture
  | "captured"     // photo taken, review/retake
  | "processing"   // sending to OCR
  | "enriching"    // calling NHTSA for full details
  | "success"      // navigating
  | "error";

type TorchTrack = MediaStreamTrack & {
  getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
};

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<State>("requesting");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMsg("");
    setCapturedImage(null);
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

      const track = stream.getVideoTracks()[0] as TorchTrack;
      const caps = track.getCapabilities?.();
      if (caps && "torch" in caps) setTorchAvailable(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("live");
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
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedImage(dataUrl);
    setState("captured");
    cleanup();
  }, [cleanup]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setErrorMsg("");
    startCamera();
  }, [startCamera]);

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet & { torch?: boolean }],
      });
      setTorchOn(!torchOn);
    } catch {
      // Torch not actually supported
    }
  }, [torchOn]);

  const processPhoto = useCallback(async () => {
    if (!capturedImage) return;
    setState("processing");
    setErrorMsg("");

    try {
      // Convert data URL to blob for FormData upload
      const blob = await fetch(capturedImage).then((r) => r.blob());
      const formData = new FormData();
      formData.append("image", blob, "disc.jpg");

      const response = await fetch("/api/parse-disc", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        success: boolean;
        parsed?: ParsedDisc;
        error?: string;
      };

      if (!response.ok || !result.success || !result.parsed) {
        setState("error");
        setErrorMsg(result.error || "Could not read disc data from photo. Try a clearer angle.");
        return;
      }

      const parsed = result.parsed;

      // Enrich via NHTSA if we have a valid VIN
      let details: VehicleDetails | undefined;
      let enrichedBodyType = parsed.bodyType;

      if (parsed.vin && parsed.vin.length === 17) {
        setState("enriching");
        try {
          const enrichResp = await fetch("/api/decode-vin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vin: parsed.vin }),
          });
          if (enrichResp.ok) {
            const enrichData = (await enrichResp.json()) as {
              success: boolean;
              bodyType?: string;
              details?: VehicleDetails;
            };
            if (enrichData.success) {
              details = enrichData.details;
              if (!enrichedBodyType && enrichData.bodyType) {
                enrichedBodyType = enrichData.bodyType;
              }
            }
          }
        } catch {
          // NHTSA enrichment optional — proceed with OCR data
        }
      }

      const merged: ParsedDisc = {
        ...parsed,
        bodyType: enrichedBodyType,
        details,
      };

      try {
        sessionStorage.setItem(STORAGE_KEY_PARSED, JSON.stringify(merged));
        sessionStorage.setItem(STORAGE_KEY_METHOD, details ? "photo-ocr+nhtsa" : "photo-ocr");
        // Save photo for quote attachment later
        sessionStorage.setItem(STORAGE_KEY_PHOTO, capturedImage);
      } catch {
        // sessionStorage may be full from large photo - non-fatal
      }

      setState("success");
      setTimeout(() => router.push("/assessments/new/vehicle"), 500);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Network error");
    }
  }, [capturedImage, router]);

  useEffect(() => {
    startCamera();
    return cleanup;
  }, [startCamera, cleanup]);

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
          Disc Photo
        </div>
        {torchAvailable && state === "live" ? (
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

      {/* Video or captured image */}
      {state === "captured" || state === "processing" || state === "enriching" || state === "success" ? (
        capturedImage && (
          <img
            src={capturedImage}
            alt="Captured disc"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Circle viewfinder overlay */}
      {state === "live" && (
        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
          <div
            className="relative rounded-full border-2 border-gold shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            style={{ width: "85vw", height: "85vw", maxWidth: "480px", maxHeight: "480px" }}
          />
        </div>
      )}

      {/* Status pill (above the circle) */}
      <div className="absolute z-20 left-0 right-0 top-[15%] pointer-events-none">
        <div className="text-center px-4">
          {state === "live" && (
            <div className="inline-block bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 border border-white/10">
              <div className="text-sm text-white">Centre the disc in the circle</div>
            </div>
          )}
          {state === "captured" && (
            <div className="inline-block bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 border border-white/10">
              <div className="text-sm text-white">Review the photo</div>
            </div>
          )}
          {state === "processing" && (
            <div className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 border border-gold/30">
              <div className="w-3 h-3 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
              <div className="text-sm text-gold">Reading disc...</div>
            </div>
          )}
          {state === "enriching" && (
            <div className="inline-flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 border border-gold/30">
              <div className="w-3 h-3 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
              <div className="text-sm text-gold">Looking up vehicle details...</div>
            </div>
          )}
          {state === "success" && (
            <div className="inline-flex items-center gap-2 bg-emerald-500/20 backdrop-blur-sm border border-emerald-500 rounded-full px-4 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <div className="text-sm text-emerald-300 font-semibold">Disc decoded</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 py-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent safe-bottom">
        <div className="max-w-md mx-auto">
          {/* Live: capture button */}
          {state === "live" && (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={capturePhoto}
                className="haptic-tap w-20 h-20 rounded-full bg-gold border-4 border-white/30 active:scale-95 transition-transform shadow-[0_0_20px_rgba(212,175,55,0.4)]"
                aria-label="Capture photo"
              />
              <div className="text-center text-xs text-white/70">
                Hold steady · ensure disc text is readable
              </div>
            </div>
          )}

          {/* Captured: retake or process */}
          {state === "captured" && (
            <div className="flex gap-3">
              <button
                onClick={retake}
                className="haptic-tap flex-1 bg-black/60 backdrop-blur-sm border border-white/30 text-white py-3.5 rounded-xl text-sm font-medium"
              >
                Retake
              </button>
              <button
                onClick={processPhoto}
                className="haptic-tap flex-[2] bg-gold text-black py-3.5 rounded-xl font-semibold"
              >
                Read disc →
              </button>
            </div>
          )}

          {/* Error: retry */}
          {state === "error" && (
            <div className="text-center">
              <div className="text-sm text-red-300 mb-3 px-4">{errorMsg}</div>
              <div className="flex gap-2">
                <button
                  onClick={startCamera}
                  className="haptic-tap flex-1 bg-gold text-black font-semibold py-3 rounded-xl"
                >
                  Try again
                </button>
                <button
                  onClick={() => router.push("/assessments/new/vin")}
                  className="haptic-tap flex-1 border border-white/30 text-white/80 py-3 rounded-xl text-sm"
                >
                  Use Voice VIN
                </button>
              </div>
            </div>
          )}

          {state === "requesting" && (
            <div className="text-center text-sm text-white/60">Requesting camera...</div>
          )}
        </div>
      </div>
    </div>
  );
}
