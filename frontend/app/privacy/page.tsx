"use client";

import Link from "next/link";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

export default function PrivacyPage() {
  const token = typeof window !== "undefined" ? getAccessToken() : "";
  const { user } = useAuthUser();

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-8 pt-8 pb-6">
          <h1 className="text-page-title text-primary">隱私政策</h1>
          <p className="mt-1 text-sm text-muted">
            我們如何收集、使用與保護您的個人資料。
          </p>
        </div>

        <div className="px-8 py-8 max-w-3xl">
          <article className="prose prose-sm text-primary space-y-6">
            <section>
              <h2 className="text-lg font-semibold text-primary">1. 蒐集之資料</h2>
              <p className="text-muted text-sm leading-relaxed">
                我們可能蒐集您註冊時提供的電子郵件、顯示名稱，以及使用服務時產生的行程、偏好設定與對話內容，用於提供與改進服務。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">2. 使用目的</h2>
              <p className="text-muted text-sm leading-relaxed">
                您的資料用於帳戶驗證、個人化行程建議、客服與產品優化。我們不會將您的個人資料出售予第三方。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">3. 資料保護</h2>
              <p className="text-muted text-sm leading-relaxed">
                我們採用適當技術與措施保護您的資料安全。資料傳輸時使用加密等安全機制。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">4. 您的權利</h2>
              <p className="text-muted text-sm leading-relaxed">
                您可於設定中檢視、更新個人資料，或聯絡我們行使查詢、更正、刪除等權利。
              </p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-primary">5. 政策更新</h2>
              <p className="text-muted text-sm leading-relaxed">
                隱私政策可能因法規或服務調整而更新，重大變更將透過服務或電子郵件通知。
              </p>
            </section>
          </article>

          <div className="mt-10 pt-6 border-t border-border">
            <Link href="/terms" className="text-sm text-primary hover:underline">服務條款</Link>
            <span className="mx-2 text-muted">|</span>
            <Link href={token ? "/" : "/login"} className="text-sm text-primary hover:underline">返回</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
