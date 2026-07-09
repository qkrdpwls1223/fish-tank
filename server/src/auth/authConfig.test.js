import { describe, it, expect } from "vitest";
import { buildAuthParams } from "./authConfig.js";

// 환경 변수 → 검증 파라미터(audience/issuer/jwksUri) 유도 로직.
describe("buildAuthParams", () => {
  it("tenant/client id 로 issuer, audience, jwksUri 기본값을 유도한다", () => {
    const params = buildAuthParams({
      TEAMS_TENANT_ID: "tenant-abc",
      TEAMS_APP_CLIENT_ID: "client-xyz",
    });
    expect(params.issuer).toBe(
      "https://login.microsoftonline.com/tenant-abc/v2.0"
    );
    // audience 는 clientId 와 api://<clientId> 두 형태를 모두 허용한다.
    expect(params.audience).toEqual(["client-xyz", "api://client-xyz"]);
    expect(params.jwksUri).toBe(
      "https://login.microsoftonline.com/tenant-abc/discovery/v2.0/keys"
    );
  });

  it("TEAMS_APP_ID_URI 가 있으면 허용 audience 목록에 추가한다", () => {
    const params = buildAuthParams({
      TEAMS_TENANT_ID: "tenant-abc",
      TEAMS_APP_CLIENT_ID: "client-xyz",
      TEAMS_APP_ID_URI: "api://fishtank.fllab.internal/client-xyz",
    });
    expect(params.audience).toContain("api://fishtank.fllab.internal/client-xyz");
    expect(params.audience).toContain("client-xyz");
    expect(params.audience).toContain("api://client-xyz");
  });

  it("기본 audience 와 중복되는 TEAMS_APP_ID_URI 는 중복 추가하지 않는다", () => {
    const params = buildAuthParams({
      TEAMS_TENANT_ID: "tenant-abc",
      TEAMS_APP_CLIENT_ID: "client-xyz",
      TEAMS_APP_ID_URI: "api://client-xyz",
    });
    expect(params.audience).toEqual(["client-xyz", "api://client-xyz"]);
  });

  it("TEAMS_JWKS_URI 가 있으면 그 값을 우선 사용한다", () => {
    const params = buildAuthParams({
      TEAMS_TENANT_ID: "tenant-abc",
      TEAMS_APP_CLIENT_ID: "client-xyz",
      TEAMS_JWKS_URI: "https://example.test/keys",
    });
    expect(params.jwksUri).toBe("https://example.test/keys");
  });

  it("필수 값(TEAMS_TENANT_ID)이 없으면 명확한 오류를 던진다", () => {
    expect(() =>
      buildAuthParams({ TEAMS_APP_CLIENT_ID: "client-xyz" })
    ).toThrow(/TEAMS_TENANT_ID/);
  });

  it("필수 값(TEAMS_APP_CLIENT_ID)이 없으면 명확한 오류를 던진다", () => {
    expect(() =>
      buildAuthParams({ TEAMS_TENANT_ID: "tenant-abc" })
    ).toThrow(/TEAMS_APP_CLIENT_ID/);
  });
});
