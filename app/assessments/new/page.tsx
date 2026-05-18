"use client";

export const dynamic = "force-dynamic";

import dynamic from "next/dynamic";

// Dynamic import â€” keeps ZXing bundle (~150KB) out of the main page chunk
const DiscScanner = dynamic(() => import("@/components/DiscScanner"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-bg flex items-center justify-center text-white/40 font-mono text-xs uppercase tracking-wider">
      Loading scanner...
    </div>
  ),
});

export default function NewAssessmentPage() {
  return <DiscScanner />;
}
