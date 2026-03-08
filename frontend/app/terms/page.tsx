"use client";

import Link from "next/link";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

export default function TermsPage() {
  const token = typeof window !== "undefined" ? getAccessToken() : "";
  const { user } = useAuthUser();

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-8 pt-8 pb-6">
          <h1 className="text-page-title text-primary">服務條款</h1>
          <p className="mt-1 text-sm text-muted">
            使用 AIYO 即表示您同意以下條款。
          </p>
        </div>

        <div className="px-8 py-8 max-w-3xl">
          <article className="prose prose-sm text-primary space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-primary">1. 服務說明</h2>
              <p className="text-muted text-sm leading-relaxed">
                AIYO 提供以 AI 輔助的旅遊規劃服務，包含行程建議、地圖與景點資訊等。服務內容可能隨產品更新而調整。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">2. 帳戶與資料</h2>
              <p className="text-muted text-sm leading-relaxed">
                您需提供正確的註冊資訊並妥善保管帳密。我們會依隱私政策處理您的個人資料。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">3. 使用規範</h2>
              <p className="text-muted text-sm leading-relaxed">
                您同意合法、合理使用本服務，不進行干擾系統、爬取資料或侵害他人權益之行為。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">4. 免責聲明</h2>
              <p className="text-muted text-sm leading-relaxed">
                AI 產出之行程與建議僅供參考，實際交通、營業時間與景點狀況請以官方或現場為準。我們不對第三方內容之正確性負責。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">5. 條款變更</h2>
              <p className="text-muted text-sm leading-relaxed">
                我們保留修改本條款之權利，重大變更將透過服務內公告或電子郵件通知。
              </p>
            </section>
          </article>

          <div className="mt-10 pt-6 border-t border-border">
            <Link href="/privacy" className="text-sm text-primary hover:underline">隱私政策</Link>
            <span className="mx-2 text-muted">|</span>
            <Link href={token ? "/" : "/login"} className="text-sm text-primary hover:underline">返回</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
