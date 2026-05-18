import Link from 'next/link';
import {
  CameraIcon,
  ClockIcon,
  CheckCircleIcon,
} from '@/components/ui/Icons';

export default function HomePage() {
  return (
    <main className="min-h-screen px-5 py-6 max-w-md mx-auto flex flex-col safe-top">
      <header className="pb-8 pt-3 animate-fade-in">
        <div className="font-mono text-[10px] text-gold tracking-widest uppercase">
          Panel beater workflow
        </div>
        <h1 className="font-display text-3xl tracking-tight leading-none mt-1">
          AutoAssess
        </h1>
        <p className="text-sm text-white/50 mt-3">
          Good evening. What would you like to do?
        </p>
      </header>

      <div className="space-y-3 flex-1">
        {/* Primary action — new assessment */}
        <Link
          href="/assessments/new"
          className="block bg-gold text-black rounded-3xl p-6 haptic-tap relative overflow-hidden animate-slide-up"
          style={{
            boxShadow: '0 20px 60px -15px rgba(212, 175, 55, 0.4)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                Start
              </div>
              <div className="font-display text-2xl font-medium leading-tight mt-1">
                New assessment
              </div>
              <div className="text-xs opacity-80 mt-1">
                Scan licence disc to begin
              </div>
            </div>
            <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center text-gold shrink-0 ml-3">
              <CameraIcon className="w-6 h-6" />
            </div>
          </div>
        </Link>

        {/* Active assessments — populated from DB in production */}
        <Link
          href="/assessments?status=active"
          className="block bg-surface border border-border rounded-3xl p-6 haptic-tap animate-slide-up"
          style={{ animationDelay: '0.05s' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-gold">
                Active
              </div>
              <div className="font-display text-xl font-medium leading-tight mt-1">
                Active assessments
              </div>
              <div className="text-xs text-white/50 mt-1">
                In progress, awaiting approval
              </div>
            </div>
            <div className="w-12 h-12 bg-gold/10 rounded-2xl flex items-center justify-center text-gold shrink-0 ml-3">
              <ClockIcon className="w-5 h-5" />
            </div>
          </div>
        </Link>

        {/* Completed assessments — populated from DB in production */}
        <Link
          href="/assessments?status=completed"
          className="block bg-surface border border-border rounded-3xl p-6 haptic-tap animate-slide-up"
          style={{ animationDelay: '0.1s' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">
                Archive
              </div>
              <div className="font-display text-xl font-medium leading-tight mt-1">
                Completed assessments
              </div>
              <div className="text-xs text-white/50 mt-1">
                Approved, invoiced, completed
              </div>
            </div>
            <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-400 shrink-0 ml-3">
              <CheckCircleIcon className="w-5 h-5" />
            </div>
          </div>
        </Link>
      </div>

      <footer className="pt-8 pb-2 text-center">
        <div className="text-[10px] font-mono text-white/30 uppercase tracking-widest">
          v0.1 · Adams Panel Beaters
        </div>
      </footer>
    </main>
  );
}
