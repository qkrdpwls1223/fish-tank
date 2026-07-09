import { describe, it, expect } from "vitest";
import { createPoolFromEnv } from "./pool.js";

// 연결 풀 팩토리. pg.Pool 생성은 지연 연결이라 실제 DB 없이 검증 가능하다.

describe("createPoolFromEnv", () => {
  it("DATABASE_URL 이 없으면 명확한 오류를 던진다 (자격증명 하드코딩 금지)", () => {
    expect(() => createPoolFromEnv({})).toThrow(/DATABASE_URL/);
  });

  it("DATABASE_URL 이 있으면 query 인터페이스를 가진 풀을 만든다", async () => {
    const pool = createPoolFromEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/fishtank",
    });
    expect(typeof pool.query).toBe("function");
    // 실제 연결은 시도하지 않고 즉시 종료해 자원을 해제한다.
    await pool.end();
  });
});
