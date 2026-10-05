import animate from "tailwindcss-animate";

const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["'Cascadia Mono'", "Consolas", "ui-monospace", "monospace"],
      },
      colors: {
        border: v("border"),
        input: v("input"),
        ring: v("ring"),
        background: v("background"),
        foreground: v("foreground"),
        surface: v("surface"),
        subtle: v("subtle"),
        primary: { DEFAULT: v("primary"), foreground: v("primary-foreground"), soft: v("primary-soft") },
        muted: { DEFAULT: v("muted"), foreground: v("muted-foreground") },
        accent: { DEFAULT: v("accent"), foreground: v("accent-foreground") },
        card: { DEFAULT: v("card"), foreground: v("card-foreground") },
        popover: { DEFAULT: v("popover"), foreground: v("popover-foreground") },
        success: { DEFAULT: v("success"), soft: v("success-soft") },
        warning: { DEFAULT: v("warning"), soft: v("warning-soft") },
        danger: { DEFAULT: v("danger"), soft: v("danger-soft") },
        info: { DEFAULT: v("info"), soft: v("info-soft") },
        sidebar: {
          DEFAULT: v("sidebar"),
          foreground: v("sidebar-foreground"),
          muted: v("sidebar-muted"),
          hover: v("sidebar-hover"),
          active: v("sidebar-active"),
          "active-foreground": v("sidebar-active-foreground"),
          accent: v("sidebar-accent"),
          border: v("sidebar-border"),
        },
      },
      borderRadius: {
        lg: "10px",
        md: "8px",
        sm: "6px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.04)",
        pop: "0 10px 30px -10px rgb(16 24 40 / 0.25), 0 4px 10px -6px rgb(16 24 40 / 0.12)",
      },
      keyframes: {
        flash: {
          "0%": { backgroundColor: "hsl(var(--primary) / 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        pop: {
          "0%": { transform: "scale(0.96)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        flash: "flash 900ms ease-out",
        pop: "pop 160ms ease-out",
      },
    },
  },
  plugins: [animate],
};
