import Link from "next/link";

export const revalidate = 300;

export default function HomeLandingPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-semibold">AIYO 愛遊</h1>
        <p className="mt-2 text-slate-600">
          以 ISR（5 分鐘 revalidate）提供首頁內容快取，降低重複請求成本，同時保有內容更新彈性。
        </p>
        <p className="mt-3 text-slate-600">
          你可以在主介面使用語音對話取得影片推薦、地圖路線與行程規劃。
        </p>
        <div className="mt-5">
          <Link href="/" className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
            進入 AIYO 主介面
          </Link>
        </div>
      </div>
    </main>
  );
}
