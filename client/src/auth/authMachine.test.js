import { describe, it, expect } from "vitest";
import { authReducer, initialAuthState, canWrite } from "./authMachine.js";

// REQ-AUTH-004: SSO 실패 시 오류 상태 + 재시도 경로 + 쓰기 기능 비활성화.
// REQ-AUTH-002: 인증된 신원 보유.
describe("authReducer", () => {
  it("초기 상태는 idle 이며 쓰기 불가", () => {
    expect(initialAuthState.status).toBe("idle");
    expect(canWrite(initialAuthState)).toBe(false);
  });

  it("AUTH_START → authenticating, 쓰기 불가", () => {
    const s = authReducer(initialAuthState, { type: "AUTH_START" });
    expect(s.status).toBe("authenticating");
    expect(canWrite(s)).toBe(false);
    expect(s.error).toBeNull();
  });

  it("AUTH_SUCCESS → authenticated, 신원 보유, 쓰기 가능", () => {
    const identity = { userId: "u1", displayName: "홍길동" };
    const s = authReducer(
      { status: "authenticating", identity: null, error: null },
      { type: "AUTH_SUCCESS", identity }
    );
    expect(s.status).toBe("authenticated");
    expect(s.identity).toEqual(identity);
    expect(canWrite(s)).toBe(true);
  });

  it("AUTH_FAILURE → error, 오류 메시지 보유, 쓰기 비활성화", () => {
    const s = authReducer(
      { status: "authenticating", identity: null, error: null },
      { type: "AUTH_FAILURE", error: "SSO 토큰 획득 실패" }
    );
    expect(s.status).toBe("error");
    expect(s.error).toBe("SSO 토큰 획득 실패");
    expect(canWrite(s)).toBe(false);
  });

  it("RETRY(error 상태에서) → authenticating 으로 전이하고 오류 초기화", () => {
    const errored = { status: "error", identity: null, error: "실패" };
    const s = authReducer(errored, { type: "RETRY" });
    expect(s.status).toBe("authenticating");
    expect(s.error).toBeNull();
  });

  it("알 수 없는 액션은 상태를 변경하지 않는다", () => {
    const s = authReducer(initialAuthState, { type: "UNKNOWN" });
    expect(s).toBe(initialAuthState);
  });
});
