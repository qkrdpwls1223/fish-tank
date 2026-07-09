import { describe, it, expect, vi } from "vitest";
import { authRequired } from "./authMiddleware.js";
import { AuthError } from "./errors.js";

// 가짜 Express req/res 를 만든다.
function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// NFR-SEC-001: 모든 쓰기 경로는 서버 검증된 신원만 사용한다.
describe("authRequired 미들웨어", () => {
  it("유효한 Bearer 토큰이면 req.user 를 설정하고 next() 를 호출한다", async () => {
    const identity = { userId: "u1", displayName: "홍길동", tenantId: "t1" };
    const verify = vi.fn().mockResolvedValue(identity);
    const req = { headers: { authorization: "Bearer good-token" }, body: {} };
    const res = makeRes();
    const next = vi.fn();

    await authRequired(verify)(req, res, next);

    expect(verify).toHaveBeenCalledWith("good-token");
    expect(req.user).toEqual(identity);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("Authorization 헤더가 없으면 401 을 반환한다", async () => {
    const verify = vi.fn();
    const req = { headers: {}, body: {} };
    const res = makeRes();
    const next = vi.fn();

    await authRequired(verify)(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
    expect(next).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("Bearer 형식이 아니면 401 을 반환한다", async () => {
    const verify = vi.fn();
    const req = { headers: { authorization: "Basic abc" }, body: {} };
    const res = makeRes();
    const next = vi.fn();

    await authRequired(verify)(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("토큰 검증 실패 시 401 과 실패 코드를 반환한다", async () => {
    const verify = vi.fn().mockRejectedValue(new AuthError("expired"));
    const req = { headers: { authorization: "Bearer stale" }, body: {} };
    const res = makeRes();
    const next = vi.fn();

    await authRequired(verify)(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("expired");
    expect(next).not.toHaveBeenCalled();
  });

  it("클라이언트가 보낸 body.userId 를 신뢰하지 않고 검증된 신원만 사용한다", async () => {
    // 위조 방지: 요청 본문에 다른 userId 를 넣어도 req.user 는 검증 결과여야 한다.
    const identity = { userId: "real-user", displayName: "실제", tenantId: "t1" };
    const verify = vi.fn().mockResolvedValue(identity);
    const req = {
      headers: { authorization: "Bearer good-token" },
      body: { userId: "attacker-supplied", displayName: "위조" },
    };
    const res = makeRes();
    const next = vi.fn();

    await authRequired(verify)(req, res, next);

    expect(req.user.userId).toBe("real-user");
    expect(req.user.userId).not.toBe("attacker-supplied");
  });
});
