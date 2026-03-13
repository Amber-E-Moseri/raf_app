import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        raf: {
          ink: "#11211c",
          moss: "#295948",
          sage: "#d8e6dd",
          gold: "#b6832f",
          mist: "#f3f1eb",
          clay: "#e7ddd0",
          alert: "#b45309",
          danger: "#b91c1c",
        },
      },
      boxShadow: {
        panel: "0 18px 45px -24px rgba(17, 33, 28, 0.28)",
        lift: "0 20px 55px -28px rgba(17, 33, 28, 0.24)",
        focus: "0 0 0 4px rgba(41, 89, 72, 0.14)",
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', "sans-serif"],
        display: ['"Iowan Old Style"', '"Georgia"', "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
