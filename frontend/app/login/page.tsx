"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, Sparkles, ArrowDown, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

type AuthStep = "email" | "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = window.localStorage.getItem("aiyo_token");
    if (token) {
      router.replace("/");
    }
  }, [router]);

  async function handleEmailContinue(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("請輸入電子郵件。");
      return;
    }
    setError(null);
    setStep("login");
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError(step === "register" ? "請輸入密碼。" : "Please enter your password.");
      return;
    }
    if (step === "register") {
      if (password.length < 6) {
        setError("密碼至少 6 個字元。");
        return;
      }
      if (password !== confirmPassword) {
        setError("兩次輸入的密碼不一致。");
        return;
      }
    }
    setError(null);
    setLoading(true);
    try {
      const endpoint = step === "login" ? "/api/auth/login" : "/api/auth/register";
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        token?: string;
        access_token?: string;
        error?: string;
      };
      const token = data.access_token || data.token || "";
      if (!response.ok || !token) {
        throw new Error(data.error || (step === "login" ? "Login failed." : "Registration failed."));
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem("aiyo_token", token);
      }
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleChangeEmail() {
    setStep("email");
    setPassword("");
    setConfirmPassword("");
    setError(null);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-accent">
      {/* Background - same as landing page hero */}
      <div className="absolute inset-0">
        <div className="absolute -right-20 top-20 h-[500px] w-[500px] rounded-full bg-accent-dark/20 blur-3xl" />
        <div className="absolute -left-20 bottom-20 h-[400px] w-[400px] rounded-full bg-accent-light/30 blur-3xl" />
      </div>

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-4">
        <Link href="/home" className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
          <Sparkles size={22} />
          <span className="text-lg font-bold tracking-tight">AIYO.</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          <Link href="/explore" className="text-sm font-medium text-primary/80 hover:text-primary transition-colors">
            Explore
          </Link>
          <Link href="/inspiration" className="text-sm font-medium text-primary/80 hover:text-primary transition-colors">
            Get inspired
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-primary hover:opacity-70 transition-opacity">
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

      {/* Background hero content (blurred) */}
      <div className="relative flex min-h-[calc(100vh-64px)] items-center px-6 opacity-40">
        <div className="max-w-2xl">
          <h1 className="text-hero text-primary">
            Travel<br />differently.
          </h1>
          <p className="mt-6 max-w-md text-hero-sub text-primary/80">
            AIYO brings the world to you and empowers you to experience it your way.
          </p>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-40">
        <span className="flex items-center gap-2 text-sm font-medium text-primary/70">
          Learn more <ArrowDown size={16} />
        </span>
      </div>

      {/* Auth Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/20" />

        <div className="relative z-10 w-full max-w-md rounded-2xl bg-surface p-8 shadow-modal animate-slide-up mx-4">
          {/* 關閉：離開登入流程並返回首頁 */}
          <button
            onClick={() => router.push("/home")}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted transition-colors"
            aria-label="關閉並返回首頁"
          >
            <X size={18} />
          </button>

          {/* Step indicator */}
          <div className="mb-6 flex gap-2">
            <span className={step === "email" ? "text-primary font-medium" : "text-muted"}>1. 輸入信箱</span>
            <span className="text-muted">/</span>
            <span className={step !== "email" ? "text-primary font-medium" : "text-muted"}>
              {step === "login" ? "2. 登入" : "2. 註冊"}
            </span>
          </div>

          {step === "email" && (
            <form onSubmit={handleEmailContinue} className="space-y-5">
              <div className="pt-2">
                <h2 className="text-2xl font-bold text-primary">Welcome to AIYO</h2>
                <p className="mt-1 text-sm text-muted">輸入你的電子郵件以繼續</p>
              </div>

              <Input
                type="email"
                label="電子郵件"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={error || undefined}
                disabled={loading}
                autoFocus
              />

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                繼續
              </Button>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted">或</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button type="button" variant="outline" className="w-full" disabled>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </Button>

              <p className="text-center text-xs text-muted">
                繼續即表示同意 AIYO 的{" "}
                <Link href="/terms" className="text-primary underline">服務條款</Link>，
                並已知悉{" "}
                <Link href="/privacy" className="text-primary underline">隱私政策</Link>。
              </p>
            </form>
          )}

          {step === "login" && (
            <form onSubmit={handleAuth} className="space-y-5">
              <div className="pt-2">
                <h2 className="text-2xl font-bold text-primary">歡迎回來</h2>
                <p className="mt-1 text-sm text-muted">登入你的帳號</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/30 px-4 py-2.5">
                <span className="text-sm text-primary truncate mr-2">{email}</span>
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="text-sm font-medium text-primary hover:underline shrink-0"
                >
                  更換
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-primary">密碼</label>
                <div className="relative flex items-center rounded-lg border border-border bg-surface focus-within:ring-1 focus-within:ring-primary/10 focus-within:border-primary">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="請輸入密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="flex h-11 flex-1 bg-transparent px-4 py-2 text-sm text-primary placeholder:text-muted outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="flex h-11 items-center justify-center px-3 text-muted hover:text-primary transition-colors"
                    aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="text-muted hover:text-primary hover:underline"
                  onClick={() => setError(null)}
                >
                  忘記密碼？
                </button>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "登入中..." : "登入"}
              </Button>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted">或</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep("register");
                  setPassword("");
                  setConfirmPassword("");
                  setError(null);
                }}
                className="w-full text-center text-sm font-medium text-primary hover:underline"
              >
                還沒有帳號？建立新帳號
              </button>
            </form>
          )}

          {step === "register" && (
            <form onSubmit={handleAuth} className="space-y-5">
              <div className="pt-2">
                <h2 className="text-2xl font-bold text-primary">建立帳號</h2>
                <p className="mt-1 text-sm text-muted">註冊 AIYO 免費又快速。</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/30 px-4 py-2.5">
                <span className="text-sm text-primary truncate mr-2">{email}</span>
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="text-sm font-medium text-primary hover:underline shrink-0"
                >
                  更換
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-primary">密碼（至少 6 個字元）</label>
                <div className="relative flex items-center rounded-lg border border-border bg-surface focus-within:ring-1 focus-within:ring-primary/10 focus-within:border-primary">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="請設定密碼"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    autoFocus
                    className="flex h-11 flex-1 bg-transparent px-4 py-2 text-sm text-primary placeholder:text-muted outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="flex h-11 items-center justify-center px-3 text-muted hover:text-primary transition-colors"
                    aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-primary">確認密碼</label>
                <div className="relative flex items-center rounded-lg border border-border bg-surface focus-within:ring-1 focus-within:ring-primary/10 focus-within:border-primary">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="再次輸入密碼"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    className="flex h-11 flex-1 bg-transparent px-4 py-2 text-sm text-primary placeholder:text-muted outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "註冊中..." : "建立帳號"}
              </Button>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted">或</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep("login");
                  setPassword("");
                  setConfirmPassword("");
                  setError(null);
                }}
                className="w-full text-center text-sm font-medium text-primary hover:underline"
              >
                已有帳號？登入
              </button>

              <p className="text-center text-xs text-muted">
                繼續即表示同意 AIYO 的{" "}
                <Link href="/terms" className="text-primary underline">服務條款</Link>，
                並已知悉{" "}
                <Link href="/privacy" className="text-primary underline">隱私政策</Link>。
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
