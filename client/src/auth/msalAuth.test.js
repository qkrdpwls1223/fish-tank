import { describe, it, expect, vi } from "vitest";
import {
  acquireMsalToken,
  buildMsalOptions,
  MsalAuthError,
} from "./msalAuth.js";

const SCOPES = ["api://client-1/access_as_user"];

// 페이지 이탈(리다이렉트) 경로는 절대 resolve 되지 않아야 하므로,
// 짧은 타임아웃과 경쟁시켜 "pending 유지"를 검증한다.
async function expectNeverResolves(promise) {
  const result = await Promise.race([
    promise.then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("pending"), 20)),
  ]);
  expect(result).toBe("pending");
}

function fakeMsal(overrides = {}) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    acquireTokenSilent: vi.fn(),
    acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// REQ-AUTH-001: 일반 브라우저에서 Microsoft SSO(MSAL 리다이렉트)로 토큰을 획득한다.
// 실제 MSAL 대신 주입 가능한 인스턴스로 단위 테스트한다(라이브 로그인 불필요).
describe("acquireMsalToken", () => {
  it("기존 계정이 있으면 조용히 액세스 토큰을 획득해 반환한다", async () => {
    const account = { username: "a@b.c" };
    const msal = fakeMsal({
      getAllAccounts: vi.fn().mockReturnValue([account]),
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: "api.jwt" }),
    });
    const token = await acquireMsalToken({ msalInstance: msal, scopes: SCOPES });
    expect(token).toBe("api.jwt");
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: SCOPES,
      account,
    });
    expect(msal.loginRedirect).not.toHaveBeenCalled();
  });

  it("리다이렉트 복귀 결과의 계정을 우선 사용한다", async () => {
    const account = { username: "back@b.c" };
    const msal = fakeMsal({
      handleRedirectPromise: vi.fn().mockResolvedValue({ account }),
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: "t" }),
    });
    await acquireMsalToken({ msalInstance: msal, scopes: SCOPES });
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({ account })
    );
  });

  it("계정이 없으면 loginRedirect 를 호출하고 pending 을 유지한다", async () => {
    const msal = fakeMsal();
    const promise = acquireMsalToken({ msalInstance: msal, scopes: SCOPES });
    await expectNeverResolves(promise);
    expect(msal.loginRedirect).toHaveBeenCalledWith({ scopes: SCOPES });
  });

  it("조용한 갱신 실패 시 acquireTokenRedirect 로 폴백하고 pending 을 유지한다", async () => {
    const account = { username: "a@b.c" };
    const msal = fakeMsal({
      getAllAccounts: vi.fn().mockReturnValue([account]),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("expired")),
    });
    const promise = acquireMsalToken({ msalInstance: msal, scopes: SCOPES });
    await expectNeverResolves(promise);
    expect(msal.acquireTokenRedirect).toHaveBeenCalledWith({
      scopes: SCOPES,
      account,
    });
  });

  it("초기화 실패 시 init_failed 코드로 MsalAuthError 를 던진다", async () => {
    const msal = fakeMsal({
      initialize: vi.fn().mockRejectedValue(new Error("bad config")),
    });
    await expect(
      acquireMsalToken({ msalInstance: msal, scopes: SCOPES })
    ).rejects.toMatchObject({ name: "MsalAuthError", code: "init_failed" });
  });

  it("loginRedirect 실패 시 login_failed 코드로 거부한다", async () => {
    const msal = fakeMsal({
      loginRedirect: vi.fn().mockRejectedValue(new Error("popup blocked")),
    });
    await expect(
      acquireMsalToken({ msalInstance: msal, scopes: SCOPES })
    ).rejects.toMatchObject({ code: "login_failed" });
  });

  it("대화형 폴백까지 실패하면 token_failed 코드로 거부한다", async () => {
    const account = { username: "a@b.c" };
    const msal = fakeMsal({
      getAllAccounts: vi.fn().mockReturnValue([account]),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("expired")),
      acquireTokenRedirect: vi.fn().mockRejectedValue(new Error("blocked")),
    });
    await expect(
      acquireMsalToken({ msalInstance: msal, scopes: SCOPES })
    ).rejects.toMatchObject({ code: "token_failed" });
  });

  it("빈 토큰이 반환되면 empty_token 코드로 거부한다", async () => {
    const account = { username: "a@b.c" };
    const msal = fakeMsal({
      getAllAccounts: vi.fn().mockReturnValue([account]),
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: "" }),
    });
    await expect(
      acquireMsalToken({ msalInstance: msal, scopes: SCOPES })
    ).rejects.toMatchObject({ code: "empty_token" });
  });

  it("MsalAuthError 는 원본 원인(cause)을 보존한다", () => {
    const cause = new Error("root");
    const err = new MsalAuthError("init_failed", "실패", cause);
    expect(err.cause).toBe(cause);
    expect(err.code).toBe("init_failed");
  });
});

describe("buildMsalOptions", () => {
  const env = {
    VITE_TEAMS_APP_CLIENT_ID: "client-1",
    VITE_TEAMS_TENANT_ID: "tenant-1",
  };

  it("클라이언트/테넌트 ID 로 테넌트 고정 authority 와 기본 스코프를 만든다", () => {
    const { msalConfig, scopes } = buildMsalOptions(env);
    expect(msalConfig.auth.clientId).toBe("client-1");
    expect(msalConfig.auth.authority).toBe(
      "https://login.microsoftonline.com/tenant-1"
    );
    expect(scopes).toEqual(["api://client-1/access_as_user"]);
  });

  it("VITE_TEAMS_APP_ID_URI 가 있으면 스코프에 우선 사용한다", () => {
    const { scopes } = buildMsalOptions({
      ...env,
      VITE_TEAMS_APP_ID_URI: "api://fishtank.example.com/client-1",
    });
    expect(scopes).toEqual(["api://fishtank.example.com/client-1/access_as_user"]);
  });

  it.each([
    ["VITE_TEAMS_APP_CLIENT_ID", { VITE_TEAMS_TENANT_ID: "t" }],
    ["VITE_TEAMS_TENANT_ID", { VITE_TEAMS_APP_CLIENT_ID: "c" }],
  ])("%s 누락 시 config_missing 으로 던진다", (_name, partial) => {
    expect(() => buildMsalOptions(partial)).toThrow(MsalAuthError);
  });
});
