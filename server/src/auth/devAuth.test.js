import { describe, it, expect, vi } from "vitest";
import {
  isDevBypassEnabled,
  createDevVerifier,
  resolveVerifier,
  DEV_IDENTITY,
} from "./devAuth.js";

describe("개발용 인증 우회 (devAuth)", () => {
  describe("isDevBypassEnabled", () => {
    it("플래그가 없으면 기본적으로 비활성이다", () => {
      expect(isDevBypassEnabled({})).toBe(false);
    });

    it("DEV_AUTH_BYPASS=1 이면 활성이다 (비프로덕션)", () => {
      expect(isDevBypassEnabled({ DEV_AUTH_BYPASS: "1" })).toBe(true);
      expect(isDevBypassEnabled({ DEV_AUTH_BYPASS: "true" })).toBe(true);
    });

    it("NODE_ENV=production 이면 플래그가 있어도 비활성이다", () => {
      expect(
        isDevBypassEnabled({ DEV_AUTH_BYPASS: "1", NODE_ENV: "production" })
      ).toBe(false);
    });
  });

  describe("createDevVerifier", () => {
    it("토큰과 무관하게 고정 개발 신원을 반환한다", async () => {
      const verify = createDevVerifier();
      await expect(verify("아무_토큰")).resolves.toEqual(DEV_IDENTITY);
      await expect(verify("다른_토큰")).resolves.toEqual(DEV_IDENTITY);
    });
  });

  describe("resolveVerifier", () => {
    it("우회 활성 시 개발 검증기를 반환한다(임의 토큰 허용)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const verify = resolveVerifier({ DEV_AUTH_BYPASS: "1" });
      await expect(verify("no-real-token")).resolves.toEqual(DEV_IDENTITY);
      expect(warn).toHaveBeenCalled(); // 우회는 조용히 켜지지 않는다
      warn.mockRestore();
    });

    it("우회 비활성 시 실제 검증 경로를 사용한다(TEAMS 값 없으면 예외)", () => {
      // createVerifierFromEnv 는 TEAMS_TENANT_ID/CLIENT_ID 가 없으면 throw 한다.
      expect(() => resolveVerifier({})).toThrow(/TEAMS_TENANT_ID/);
    });

    it("production 에서는 플래그가 있어도 실제 검증 경로를 사용한다", () => {
      // 우회가 무시되므로 실제 경로가 선택되고, TEAMS 값이 없어 throw 한다.
      expect(() =>
        resolveVerifier({ DEV_AUTH_BYPASS: "1", NODE_ENV: "production" })
      ).toThrow(/TEAMS_TENANT_ID/);
    });
  });
});
