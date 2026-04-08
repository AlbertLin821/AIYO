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
          DEFAULT: "#1B4965",
          foreground: "#FFFFFF",
          muted: "#2E6B8A",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F1F5F9",
          hover: "#E8EEF4",
          canvas: "#F7F9FB",
        },
        muted: {
          DEFAULT: "#64748B",
          foreground: "#334155",
        },
        accent: {
          DEFAULT: "#FF6B35",
          dark: "#E85A28",
          light: "#FF8F66",
        },
        border: {
          DEFAULT: "#E2E8F0",
          light: "#F1F5F9",
        },
        travel: {
          sky: "#7EB6D9",
          ocean: "#0B4F6C",
          sand: "#E8DCC4",
          forest: "#2D6A4F",
          sunset: "#F4845F",
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
        hero: ["4.5rem", { lineHeight: "1.05", fontWeight: "800" }],
        "hero-sub": ["1.25rem", { lineHeight: "1.6", fontWeight: "400" }],
        "page-title": ["2rem", { lineHeight: "1.2", fontWeight: "700" }],
        "section-title": ["1.5rem", { lineHeight: "1.3", fontWeight: "600" }],
      },
      borderRadius: {
        card: "16px",
        panel: "16px",
        btn: "999px",
      },
      boxShadow: {
        card: "0 1px 3px rgba(27, 73, 101, 0.08)",
        modal: "0 8px 30px rgba(27, 73, 101, 0.14)",
        "card-hover": "0 4px 12px rgba(27, 73, 101, 0.12)",
      },
      spacing: {
        sidebar: "200px",
        "sidebar-collapsed": "64px",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "slide-right": "slideRight 0.3s ease-out",
        "page-enter": "pageEnter 0.35s ease-out",
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
        pageEnter: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
