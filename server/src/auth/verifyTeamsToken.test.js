import { describe, it, expect, beforeAll } from "vitest";
import { verifyTeamsToken } from "./verifyTeamsToken.js";
import {
  createKeyMaterial,
  makeToken,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from "../../test/helpers/tokens.js";

// NFR-SEC-001: 서버 측 Teams SSO 토큰 검증. 클라이언트 값은 신뢰하지 않는다.
// REQ-AUTH-002: 검증된 사용자 ID/표시 이름을 신원 근거로 확보한다.
describe("verifyTeamsToken", () => {
  let privateKey;
  let jwks;
  const config = () => ({ jwks, audience: TEST_AUDIENCE, issuer: TEST_ISSUER });

  beforeAll(async () => {
    ({ privateKey, jwks } = await createKeyMaterial());
  });

  it("유효한 토큰을 검증하고 인증된 신원을 반환한다", async () => {
    const token = await makeToken(privateKey);
    const identity = await verifyTeamsToken(token, config());
    expect(identity).toEqual({
      userId: "user-oid-123",
      displayName: "홍길동",
      tenantId: "test-tenant-id",
    });
  });

  it("audience 가 기대값과 다르면 invalid_audience 로 거부한다", async () => {
    const token = await makeToken(privateKey, { audience: "api://someone-else" });
    await expect(verifyTeamsToken(token, config())).rejects.toMatchObject({
      code: "invalid_audience",
    });
  });

  it("issuer 가 기대값과 다르면 invalid_issuer 로 거부한다", async () => {
    const token = await makeToken(privateKey, {
      issuer: "https://login.microsoftonline.com/evil-tenant/v2.0",
    });
    await expect(verifyTeamsToken(token, config())).rejects.toMatchObject({
      code: "invalid_issuer",
    });
  });

  it("만료된 토큰을 expired 로 거부한다", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = await makeToken(privateKey, { exp: past, iat: past - 60 });
    await expect(verifyTeamsToken(token, config())).rejects.toMatchObject({
      code: "expired",
    });
  });

  it("다른 키로 서명된(위조) 토큰을 invalid_signature 로 거부한다", async () => {
    const other = await createKeyMaterial();
    const forged = await makeToken(other.privateKey);
    // 검증은 우리(신뢰) JWKS 로만 수행한다.
    await expect(verifyTeamsToken(forged, config())).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });

  it("형식이 잘못된 토큰을 malformed 로 거부한다", async () => {
    await expect(
      verifyTeamsToken("not-a-jwt", config())
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("빈 토큰을 malformed 로 거부한다", async () => {
    await expect(verifyTeamsToken("", config())).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("필수 신원 클레임(oid)이 없으면 missing_claim 으로 거부한다", async () => {
    const token = await makeToken(privateKey, { claims: { oid: undefined } });
    await expect(verifyTeamsToken(token, config())).rejects.toMatchObject({
      code: "missing_claim",
    });
  });
});
