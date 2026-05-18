'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeftIcon,
  CameraIcon,
  EditIcon,
  CheckIcon,
} from '@/components/ui/Icons';

type State =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'capturing'
  | 'captured'
  | 'error';

export default function DiscScanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setState('requesting');
    setError(null);

    // Browser support check
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setError('Camera not supported in this browser. Use manual entry.');
      setState('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(()=>{});
      }
      setState('ready');
    } catch (err: unknown) {
      console.error('Camera error:', err);
      const e = err as { name?: string; message?: string };
      let msg = 'Could not access camera. Use manual entry instead.';
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        msg =
          'Camera permission denied. Please allow camera access in your browser settings and refresh.';
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        msg = 'No camera found on this device. Use manual entry instead.';
      } else if (e.name === 'NotReadableError') {
        msg = 'Camera is in use by another app. Close it and try again.';
      } else if (
        e.message &&
        (e.message.includes('https') || e.message.includes('secure'))
      ) {
        msg =
          'Camera requires HTTPS. Use https:// or localhost.';
      }
      setError(msg);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  const takePicture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    if (state !== 'ready') return;

    setState('capturing');

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setState('ready');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedImage(dataUrl);
    setState('captured');

    stopCamera();

    // Stash for the next screen
    try {
      sessionStorage.setItem('autoassess.disc.image', dataUrl);
      sessionStorage.setItem('autoassess.disc.capturedAt', String(Date.now()));
    } catch {
      // Storage may be full — proceed anyway
    }

    // Brief confirmation, then navigate
    setTimeout(() => {
      router.push('/assessments/new/vehicle');
    }, 700);
  }, [router, state, stopCamera]);

  const goManual = useCallback(() => {
    stopCamera();
    try {
      sessionStorage.removeItem('autoassess.disc.image');
    } catch {}
    router.push('/assessments/new/vehicle?manual=1');
  }, [router, stopCamera]);

  const goBack = useCallback(() => {
    stopCamera();
    router.push('/');
  }, [router, stopCamera]);

  return (
    <main className="min-h-screen flex flex-col bg-bg safe-top safe-bottom">
      {/* Top bar */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <button
          onClick={goBack}
          className="w-10 h-10 rounded-full bg-surface border border-border flex items-center justify-center haptic-tap"
          aria-label="Back to home"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/50">
          Step 1 of 5 — Identify vehicle
        </div>
        <div className="w-10" />
      </div>

      {/* Viewfinder area */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-4">
        <div className="relative w-[86vw] max-w-[420px] aspect-square mx-auto">
          {/* Outer decorative ring */}
          <div className="absolute -inset-3 rounded-full border border-gold/20 pointer-events-none" />
          {state === 'ready' && (
            <div className="absolute -inset-3 rounded-full border-2 border-gold/40 pointer-events-none pulse-gold" />
          )}

          {/* The circle viewfinder */}
          <div className="absolute inset-0 rounded-full overflow-hidden bg-surface border-2 border-gold">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />

            {/* Overlay states */}
            {(state === 'requesting' || state === 'idle') && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg/95">
                <div className="text-center">
                  <div className="w-12 h-12 mx-auto rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
                  <div className="mt-3 text-xs font-mono text-white/60 uppercase tracking-widest">
                    Starting camera
                  </div>
                </div>
              </div>
            )}

            {state === 'captured' && capturedImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={capturedImage}
                className="absolute inset-0 w-full h-full object-cover"
                alt="Captured disc"
              />
            )}

            {state === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg/95 p-8">
                <div className="text-center">
                  <div className="text-xs text-red-400 font-medium leading-relaxed">
                    {error}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Captured confirmation overlay */}
          {state === 'captured' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-fade-in">
              <div className="bg-emerald-500 text-black rounded-full px-4 py-2 text-sm font-medium flex items-center gap-2 shadow-2xl">
                <CheckIcon className="w-4 h-4" />
                Captured
              </div>
            </div>
          )}
        </div>

        {/* Instruction text */}
        <div className="mt-8 text-center max-w-xs animate-fade-in">
          <div className="font-display text-xl tracking-tight">
            {state === 'ready' && 'Centre the licence disc'}
            {(state === 'requesting' || state === 'idle') && 'Starting camera'}
            {state === 'capturing' && 'Capturing…'}
            {state === 'captured' && 'Reading disc data…'}
            {state === 'error' && 'Camera unavailable'}
          </div>
          <div className="text-sm text-white/50 mt-2 leading-relaxed">
            {state === 'ready' &&
              'Fit the disc inside the circle and hold the phone steady'}
            {state === 'captured' && 'Extracting vehicle details from the disc'}
            {state === 'error' &&
              'You can still continue with manual entry below'}
            {(state === 'requesting' || state === 'idle') &&
              'Allow camera access when prompted'}
          </div>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="px-5 pb-6 pt-4 space-y-3">
        <button
          onClick={takePicture}
          disabled={state !== 'ready'}
          className="w-full bg-gold text-black rounded-2xl py-4 font-medium haptic-tap disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <CameraIcon className="w-5 h-5" />
          Take picture
        </button>
        <button
          onClick={goManual}
          className="w-full bg-surface border border-border text-white rounded-2xl py-4 font-medium haptic-tap flex items-center justify-center gap-2"
        >
          <EditIcon className="w-5 h-5" />
          Manually enter details
        </button>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </main>
  );
}
