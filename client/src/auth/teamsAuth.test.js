import { describe, it, expect, vi } from "vitest";
import {
  acquireTeamsSsoToken,
  TeamsAuthError,
} from "./teamsAuth.js";

// REQ-AUTH-001: Teams 탭을 열 때 Teams JS SDK SSO 로 세션/신원(토큰)을 획득한다.
// 실제 SDK 대신 주입 가능한 모듈로 단위 테스트한다(라이브 Teams 불필요).
describe("acquireTeamsSsoToken", () => {
  it("SDK 초기화 후 SSO 토큰을 획득해 반환한다", async () => {
    const teams = {
      app: { initialize: vi.fn().mockResolvedValue(undefined) },
      authentication: {
        getAuthToken: vi.fn().mockResolvedValue("sso.jwt.token"),
      },
    };
    const token = await acquireTeamsSsoToken(teams);
    expect(teams.app.initialize).toHaveBeenCalledOnce();
    expect(teams.authentication.getAuthToken).toHaveBeenCalledOnce();
    expect(token).toBe("sso.jwt.token");
  });

  it("초기화 실패 시 init_failed 코드로 TeamsAuthError 를 던진다", async () => {
    const teams = {
      app: { initialize: vi.fn().mockRejectedValue(new Error("no context")) },
      authentication: { getAuthToken: vi.fn() },
    };
    await expect(acquireTeamsSsoToken(teams)).rejects.toMatchObject({
      name: "TeamsAuthError",
      code: "init_failed",
    });
    expect(teams.authentication.getAuthToken).not.toHaveBeenCalled();
  });

  it("토큰 획득 실패 시 token_failed 코드로 TeamsAuthError 를 던진다", async () => {
    const teams = {
      app: { initialize: vi.fn().mockResolvedValue(undefined) },
      authentication: {
        getAuthToken: vi.fn().mockRejectedValue(new Error("consent required")),
      },
    };
    await expect(acquireTeamsSsoToken(teams)).rejects.toMatchObject({
      code: "token_failed",
    });
  });

  it("빈 토큰이 반환되면 empty_token 코드로 거부한다", async () => {
    const teams = {
      app: { initialize: vi.fn().mockResolvedValue(undefined) },
      authentication: { getAuthToken: vi.fn().mockResolvedValue("") },
    };
    await expect(acquireTeamsSsoToken(teams)).rejects.toMatchObject({
      code: "empty_token",
    });
  });

  it("TeamsAuthError 는 원본 원인(cause)을 보존한다", () => {
    const cause = new Error("root");
    const err = new TeamsAuthError("init_failed", "실패", cause);
    expect(err.cause).toBe(cause);
    expect(err.code).toBe("init_failed");
  });
});
