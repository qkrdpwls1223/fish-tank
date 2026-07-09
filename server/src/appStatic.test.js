import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";

// 프로덕션 정적 서빙(클라이언트 dist + SPA 폴백 + Teams 임베드 CSP) 검증.
// staticDir 미주입 시(개발/기존 테스트) 아무 영향이 없어야 한다.

const verify = async () => ({ userId: "u1", displayName: "홍길동" });

let dir;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "fishtank-dist-"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>공유 어항</title>");
  writeFileSync(path.join(dir, "app.js"), "console.log('ok')");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createApp — staticDir 서빙", () => {
  it("루트 요청에 index.html 을 응답하고 Teams 임베드 CSP 를 붙인다", async () => {
    const app = createApp({ verify, staticDir: dir });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("공유 어항");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors");
    expect(res.headers["content-security-policy"]).toContain("teams.microsoft.com");
    // 현행 Teams 웹 클라이언트의 통합 도메인이 반드시 포함돼야 iframe 이 차단되지 않는다.
    expect(res.headers["content-security-policy"]).toContain("*.cloud.microsoft");
  });

  it("정적 자산은 그대로 서빙한다", async () => {
    const app = createApp({ verify, staticDir: dir });
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("ok");
  });

  it("알 수 없는 경로는 SPA 폴백으로 index.html 을 준다", async () => {
    const app = createApp({ verify, staticDir: dir });
    const res = await request(app).get("/some/deep/route");
    expect(res.status).toBe(200);
    expect(res.text).toContain("공유 어항");
  });

  it("API 경로는 폴백하지 않고 기존 동작(인증 경계)을 유지한다", async () => {
    const app = createApp({ verify, staticDir: dir });
    const res = await request(app).get("/api/me"); // 토큰 없음 → 401
    expect(res.status).toBe(401);
  });

  it("healthz 는 정적 서빙과 무관하게 동작한다", async () => {
    const app = createApp({ verify, staticDir: dir });
    const res = await request(app).get("/healthz");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("staticDir 미주입이면 루트 요청은 404 다(기존 동작 보존)", async () => {
    const app = createApp({ verify });
    const res = await request(app).get("/");
    expect(res.status).toBe(404);
  });
});
