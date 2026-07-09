import { defineConfig } from "vitest/config";

// 서버 테스트 설정 (Node 환경, v8 커버리지)
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "test/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.js"],
      exclude: ["src/server.js", "**/*.test.js", "test/**"],
    },
  },
});
