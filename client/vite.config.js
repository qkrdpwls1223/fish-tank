import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 클라이언트 빌드/테스트 설정 (React, jsdom 환경)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 개발 서버에서 API/WebSocket 요청을 백엔드(:3000)로 전달한다.
    // 클라이언트는 /api, /realtime 를 상대 경로로 호출하므로 프록시가 필요하다.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/realtime": { target: "ws://localhost:3000", ws: true },
    },
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
