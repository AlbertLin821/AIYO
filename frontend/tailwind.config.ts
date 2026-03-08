import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#000000",
          foreground: "#FFFFFF",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F7F7F7",
          hover: "#F0F0F0",
        },
        muted: {
          DEFAULT: "#6B7280",
          foreground: "#374151",
        },
        accent: {
          DEFAULT: "#F5A623",
          dark: "#E09000",
          light: "#FFC857",
        },
        border: {
          DEFAULT: "#E5E7EB",
          light: "#F3F4F6",
        },
        success: "#16A34A",
        danger: "#DC2626",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Noto Sans TC",
          "sans-serif",
        ],
      },
      fontSize: {
        "hero": ["4.5rem", { lineHeight: "1.05", fontWeight: "800" }],
        "hero-sub": ["1.25rem", { lineHeight: "1.6", fontWeight: "400" }],
        "page-title": ["2rem", { lineHeight: "1.2", fontWeight: "700" }],
        "section-title": ["1.5rem", { lineHeight: "1.3", fontWeight: "600" }],
      },
      borderRadius: {
        card: "16px",
        btn: "999px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08)",
        modal: "0 8px 30px rgba(0,0,0,0.12)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.1)",
      },
      spacing: {
        sidebar: "200px",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "slide-right": "slideRight 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideRight: {
          "0%": { opacity: "0", transform: "translateX(-10px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
