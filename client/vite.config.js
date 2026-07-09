import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 클라이언트 빌드/테스트 설정 (React, jsdom 환경)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/main.jsx", "src/test/**", "**/*.test.{js,jsx}"],
    },
  },
});
