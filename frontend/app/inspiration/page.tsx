"use client";

import Link from "next/link";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Sparkles, Compass, MapPin, Camera } from "lucide-react";
import { getAccessToken } from "@/lib/api";
import { useAuthUser } from "@/lib/hooks/useAuthUser";

const inspirationItems = [
  { title: "城市小旅行", desc: "週末出發，用 AI 規劃一日或兩日輕旅行。", href: "/", icon: MapPin },
  { title: "美食主題路線", desc: "從早午餐到夜市，依口味與預算排一條吃到底的路線。", href: "/explore?q=food", icon: Compass },
  { title: "打卡景點精選", desc: "熱門地標與秘境一次收錄，拖放排序成你的行程。", href: "/explore", icon: Camera },
];

export default function InspirationPage() {
  const token = typeof window !== "undefined" ? getAccessToken() : "";
  const { user } = useAuthUser();

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <AppSidebar user={user ?? undefined} />

      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-8 pt-8 pb-0">
          <h1 className="text-page-title text-primary">Get inspired</h1>
          <p className="mt-1 text-sm text-muted">
            從靈感開始，用 AI 幫你規劃下一趟旅行。
          </p>
        </div>

        <div className="px-8 py-12">
          <div className="mx-auto max-w-2xl space-y-8">
            <section>
              <h2 className="text-lg font-semibold text-primary mb-4">熱門玩法</h2>
              <ul className="space-y-4">
                {inspirationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.title}>
                      <Link
                        href={item.href}
                        className="flex items-start gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-surface-muted"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                          <Icon size={20} className="text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium text-primary">{item.title}</h3>
                          <p className="mt-1 text-sm text-muted">{item.desc}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-surface-muted/30 p-6">
              <h2 className="text-lg font-semibold text-primary mb-2">開始規劃</h2>
              <p className="text-sm text-muted mb-4">
                告訴 AI 你想去哪裡、幾天、預算與旅伴，就能得到專屬行程建議。
              </p>
              <Link
                href={token ? "/" : "/login"}
                className="inline-flex items-center gap-2 rounded-btn bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Sparkles size={16} />
                {token ? "前往規劃頁" : "登入後開始"}
              </Link>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
