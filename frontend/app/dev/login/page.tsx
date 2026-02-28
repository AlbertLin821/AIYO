"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

export default function DevLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/dev/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "login failed");
        return;
      }
      sessionStorage.setItem("dev_token", data.token);
      sessionStorage.setItem("dev_email", data.email);
      router.push("/dev/dashboard");
    } catch {
      setError("network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md"
      >
        <h1 className="mb-6 text-center text-xl font-bold text-gray-800">
          AIYO Developer Console
        </h1>

        {error && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <label className="mb-1 block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          type="email"
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="mb-1 block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          type="password"
          className="mb-6 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
