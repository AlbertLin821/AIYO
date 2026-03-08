import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIYO - AI 旅遊規劃",
  description: "AIYO 以 AI 為你量身打造個人化旅遊行程，體驗不一樣的旅行方式。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
