"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MessageCircle,
  Map,
  Sparkles,
  Globe,
  ArrowDown,
  Utensils,
  Hotel,
  Plane,
  X,
} from "lucide-react";

function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <>
      <nav className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <button
            className="mr-2 flex h-8 w-8 items-center justify-center rounded-md text-primary hover:bg-black/5 transition-colors md:hidden"
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <path d="M1 1h16M1 7h16M1 13h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/home" className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
            <Sparkles size={22} />
            <span className="text-lg font-bold tracking-tight">AIYO.</span>
          </Link>
        </div>

        <div className="hidden items-center gap-8 md:flex">
          <Link href="/explore" className="text-sm font-medium text-primary/80 hover:text-primary transition-colors">
            Explore
          </Link>
          <Link href="/inspiration" className="text-sm font-medium text-primary/80 hover:text-primary transition-colors">
            Get inspired
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-primary hover:opacity-70 transition-opacity"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="rounded-btn border border-primary bg-transparent px-4 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            Get started
          </Link>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 flex h-full w-64 flex-col bg-surface p-6 shadow-lg">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <Sparkles size={22} />
                <span className="text-lg font-bold tracking-tight">AIYO.</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1" aria-label="Close menu">
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <Link href="/explore" className="text-sm font-medium text-primary/80 hover:text-primary" onClick={() => setMobileMenuOpen(false)}>Explore</Link>
              <Link href="/inspiration" className="text-sm font-medium text-primary/80 hover:text-primary" onClick={() => setMobileMenuOpen(false)}>Get inspired</Link>
              <Link href="/login" className="text-sm font-medium text-primary hover:opacity-70" onClick={() => setMobileMenuOpen(false)}>Log in</Link>
              <Link href="/login" className="rounded-btn border border-primary bg-transparent px-4 py-2 text-sm font-medium text-primary text-center hover:bg-primary hover:text-primary-foreground transition-colors" onClick={() => setMobileMenuOpen(false)}>Get started</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HeroSection() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-accent">
      <Navbar />

      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -right-20 top-20 h-[500px] w-[500px] rounded-full bg-accent-dark/20 blur-3xl" />
        <div className="absolute -left-20 bottom-20 h-[400px] w-[400px] rounded-full bg-accent-light/30 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl items-center px-6 pt-20">
        <div className="max-w-2xl">
          <h1 className="text-hero text-primary">
            Travel<br />differently.
          </h1>
          <p className="mt-6 max-w-md text-hero-sub text-primary/80">
            AIYO 以 AI 為你量身打造旅遊行程，讓你用自己的方式體驗世界。
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-btn bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Start chatting
            </Link>
            <Link href="/" className="flex items-center gap-2 text-sm font-medium text-primary hover:opacity-70 transition-opacity">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary">
                <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
                  <path d="M0 0v14l12-7z" />
                </svg>
              </span>
              Watch demo
            </Link>
          </div>
        </div>

        <div className="hidden flex-1 items-center justify-end lg:flex">
          <div className="relative">
            <div className="h-[420px] w-[280px] rounded-[40px] bg-gradient-to-b from-primary/10 to-primary/5 p-1 shadow-lg">
              <div className="flex h-full flex-col items-center justify-center rounded-[36px] bg-surface/80 backdrop-blur-sm p-6">
                <Globe size={48} className="text-primary/40 mb-4" />
                <div className="space-y-3 w-full">
                  <div className="flex items-center gap-2 rounded-xl bg-surface p-3 shadow-card">
                    <div className="h-8 w-8 rounded-full bg-accent/20" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2 w-20 rounded-full bg-primary/20" />
                      <div className="h-2 w-14 rounded-full bg-primary/10" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl bg-surface p-3 shadow-card">
                    <div className="h-8 w-8 rounded-full bg-accent/20" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2 w-24 rounded-full bg-primary/20" />
                      <div className="h-2 w-16 rounded-full bg-primary/10" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <button
          onClick={() => document.getElementById("features-section")?.scrollIntoView({ behavior: "smooth" })}
          className="flex items-center gap-2 text-sm font-medium text-primary/70 hover:text-primary transition-colors animate-bounce"
        >
          Learn more <ArrowDown size={16} />
        </button>
      </div>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-6 transition-shadow hover:shadow-card-hover">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-muted">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-primary">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section id="features-section" className="bg-surface py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center">
          <h2 className="text-page-title text-primary">
            AI 驅動的旅遊規劃
          </h2>
          <p className="mt-3 text-muted">
            從靈感到行程，一次搞定你的完美旅行。
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<MessageCircle size={24} className="text-primary" />}
            title="AI 對話規劃"
            description="用自然語言告訴 AI 你的旅行想法，即時獲得個人化行程建議。"
          />
          <FeatureCard
            icon={<Map size={24} className="text-primary" />}
            title="互動式地圖"
            description="所有景點即時標記在地圖上，直覺拖放調整行程順序。"
          />
          <FeatureCard
            icon={<Utensils size={24} className="text-primary" />}
            title="在地美食推薦"
            description="探索當地人推薦的餐廳，從街邊小吃到米其林餐廳。"
          />
          <FeatureCard
            icon={<Hotel size={24} className="text-primary" />}
            title="住宿搜尋"
            description="根據預算和偏好，找到最適合的飯店與民宿。"
          />
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    { number: "01", title: "告訴 AI 你的想法", description: "輸入你想去的地方、天數、預算和旅伴類型。" },
    { number: "02", title: "獲得個人化行程", description: "AI 為你規劃每日行程，包含景點、餐廳和交通。" },
    { number: "03", title: "自由調整", description: "透過對話修改行程，拖放景點重新排序。" },
    { number: "04", title: "出發旅行", description: "行程同步到手機，隨時查看下一站資訊。" },
  ];

  return (
    <section className="bg-surface-muted py-24">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-page-title text-primary">如何開始</h2>
        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-bold">
                {step.number}
              </div>
              <h3 className="text-lg font-semibold text-primary">{step.title}</h3>
              <p className="mt-2 text-sm text-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="bg-primary py-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <Plane size={40} className="mx-auto mb-6 text-primary-foreground/60" />
        <h2 className="text-page-title text-primary-foreground">
          準備好開始你的旅程了嗎？
        </h2>
        <p className="mt-4 text-primary-foreground/70">
          免費開始使用 AIYO，讓 AI 為你規劃一場難忘的旅行。
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-btn bg-accent px-8 py-3.5 text-base font-semibold text-white hover:bg-accent-dark transition-colors"
        >
          Start chatting
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-surface py-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <Sparkles size={18} />
          <span className="text-sm font-bold">AIYO.</span>
        </div>
        <div className="flex items-center gap-6 text-xs text-muted">
          <Link href="/terms" className="hover:text-primary transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
          <span>2026 AIYO, Inc.</span>
        </div>
      </div>
    </footer>
  );
}

export default function HomeLandingPage() {
  return (
    <main className="min-h-screen">
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <CTASection />
      <Footer />
    </main>
  );
}
