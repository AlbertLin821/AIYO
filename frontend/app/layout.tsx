import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIYO 行程規劃",
  description: "AIYO 互動式旅遊行程前端"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
