import Link from 'next/link';
import {
  ArrowRight,
  LogIn,
  MapPinned,
  RadioTower,
  ShieldCheck,
  Siren,
  TriangleAlert
} from 'lucide-react';

export function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--canvas)] text-slate-950">
      <div className="app-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[44rem] bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.1),transparent_26%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-4">
            <div className="brand-mark">
              <RadioTower aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-xl tracking-[0.08em] text-slate-950 sm:tracking-[0.12em]">
                PostAlert
              </p>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Jamaica emergency intelligence
              </p>
            </div>
          </div>
          <div className="rounded-full border border-slate-900/10 bg-white/55 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-600 backdrop-blur">
            Built for citizens, responders, and verified authorities
          </div>
        </header>

        <section className="grid flex-1 gap-10 py-10 lg:grid-cols-[0.94fr_1.06fr] lg:items-center lg:py-16">
          <div className="space-y-8">
            <div className="space-y-5">
              <div className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">
                Community intelligence for Jamaica
              </div>
              <h1 className="font-display text-[clamp(4.25rem,11vw,8.8rem)] leading-[0.84] tracking-[-0.08em] text-slate-950">
                Incident
                <span className="block">Reporting</span>
                <span className="block text-amber-500">That Moves Fast.</span>
              </h1>
              <p className="max-w-xl text-lg leading-9 text-slate-600 sm:text-xl">
                PostAlert helps citizens report incidents in seconds, helps communities verify what is real, and gives verified authorities a live operational view of what is happening across Jamaica.
              </p>
            </div>

            <div className="flex flex-wrap gap-4">
              <Link
                href="/auth?mode=register"
                className="inline-flex items-center gap-3 rounded-full bg-amber-400 px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-950 shadow-[0_18px_42px_rgba(245,158,11,0.24)] transition hover:bg-amber-300"
              >
                Let&apos;s Get Started
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link
                href="/auth?mode=login"
                className="inline-flex items-center gap-3 rounded-full border border-slate-900/12 bg-white/70 px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-900 backdrop-blur transition hover:bg-white"
              >
                Login
                <LogIn aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <LandingStat
                caption="From citizen reports to verified response"
                icon={TriangleAlert}
                label="Reporting"
                value="4-step capture"
              />
              <LandingStat
                caption="Map, feed, and detail pages stay in sync"
                icon={MapPinned}
                label="Awareness"
                value="Live incident view"
              />
              <LandingStat
                caption="Verified responders unlock operational actions"
                icon={ShieldCheck}
                label="Authority mode"
                value="Protected dashboard"
              />
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-8 top-12 h-40 w-40 rounded-full bg-amber-300/30 blur-3xl" />
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-400/20 blur-3xl" />

            <div className="relative overflow-hidden rounded-[42px] border border-white/10 bg-[linear-gradient(160deg,#121b2d_0%,#1a2341_48%,#101826_100%)] p-6 text-[var(--ink)] shadow-[0_36px_90px_rgba(9,16,34,0.34)] sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="inline-flex rounded-2xl bg-amber-400 p-3 text-slate-950">
                    <Siren aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-display text-2xl text-white">Active Monitoring</div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Real-time community and authority intelligence
                    </div>
                  </div>
                </div>
                <div className="rounded-full border border-emerald-400/20 bg-emerald-500/12 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  System online
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <LandingPanel
                  eyebrow="Current focus"
                  title="Citizen reports feed the live map while verified responders track status changes and resolution."
                />
                <LandingPanel
                  eyebrow="Why it matters"
                  title="Communities see risk earlier, and responders work from sharper location detail and shared evidence."
                />
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <SignalCard label="Detection window" value="< 60 sec" />
                <SignalCard label="Live map coverage" value="14 parishes" />
                <SignalCard label="Verification loop" value="Citizen + authority" />
              </div>

              <div className="mt-6 rounded-[30px] border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Current operating flow</div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      Report. Verify. Coordinate. Resolve.
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-slate-950/40 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200">
                    Live incident intelligence
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <LandingMiniTag icon={TriangleAlert} label="Community incident alert" tone="amber" />
                  <LandingMiniTag icon={MapPinned} label="Mapped to location and parish" tone="sky" />
                  <LandingMiniTag icon={ShieldCheck} label="Authority action ready" tone="emerald" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function LandingStat({ caption, icon: Icon, label, value }) {
  return (
    <div className="rounded-[28px] border border-slate-900/10 bg-white/68 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-6 inline-flex rounded-2xl bg-slate-950 p-3 text-amber-300">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </div>
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{caption}</p>
    </div>
  );
}

function LandingPanel({ eyebrow, title }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/6 p-5">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div>
      <p className="mt-3 text-sm leading-7 text-slate-200">{title}</p>
    </div>
  );
}

function SignalCard({ label, value }) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-slate-950/26 p-4">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function LandingMiniTag({ icon: Icon, label, tone }) {
  const tones = {
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
    sky: 'border-sky-400/25 bg-sky-500/10 text-sky-100',
    emerald: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
  };

  return (
    <div className={`inline-flex items-center gap-3 rounded-full border px-4 py-3 text-sm ${tones[tone] || tones.amber}`}>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/35">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}
