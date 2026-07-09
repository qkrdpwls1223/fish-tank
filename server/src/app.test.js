import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { verifyTeamsToken } from "./auth/verifyTeamsToken.js";
import {
  createKeyMaterial,
  makeToken,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from "../test/helpers/tokens.js";

// 앱 셸 통합 테스트 (REQ-AUTH-001/002/004, NFR-SEC-001).
// 실제 검증 함수 + 위조 토큰으로 보안 경계를 종단 검증한다.
describe("app shell", () => {
  let app;
  let privateKey;

  beforeAll(async () => {
    const { privateKey: pk, jwks } = await createKeyMaterial();
    privateKey = pk;
    // 실제 검증 함수를 로컬 JWKS 로 바인딩해 앱에 주입한다.
    const verify = (token) =>
      verifyTeamsToken(token, {
        jwks,
        audience: TEST_AUDIENCE,
        issuer: TEST_ISSUER,
      });
    app = createApp({ verify });
  });

  it("GET /healthz 는 인증 없이 200 을 반환한다", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/me 는 유효한 토큰이면 검증된 신원을 반환한다", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      userId: "user-oid-123",
      displayName: "홍길동",
      tenantId: "test-tenant-id",
    });
  });

  it("GET /api/me 는 토큰이 없으면 401 을 반환한다", async () => {
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("GET /api/me 는 위조(다른 키 서명) 토큰을 401 로 거부한다", async () => {
    const other = await createKeyMaterial();
    const forged = await makeToken(other.privateKey);
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_signature");
  });
});
