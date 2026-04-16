import Link from "next/link";

export default function LegacyPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Legacy Mode</p>
        <h1 className="mt-2 text-2xl font-bold">AIYO V1 (Read-Only Window)</h1>
        <p className="mt-3 text-sm text-slate-600">
          V2 is now the active product path. This legacy screen remains available for a short read-only period
          during Phase C migration.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/v2" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Open /v2
          </Link>
          <Link
            href="/home"
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open /home
          </Link>
        </div>
      </section>
    </main>
  );
}
