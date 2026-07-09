import { describe, it, expect, vi } from "vitest";
import { sendFeed } from "./feedApi.js";

// 먹이주기 실시간 공유 API 클라이언트 (REQ-INT-003).
// 인증 토큰을 Bearer 로 실어 좌표를 서버에 전송한다. 신원은 서버가 토큰으로만 판별한다.

function okFetch(body = { ok: true }) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

describe("sendFeed", () => {
  it("Bearer 토큰과 좌표를 담아 POST /api/feed 를 호출한다 (NFR-SEC-001)", async () => {
    const fetchImpl = okFetch();
    await sendFeed({ token: "tok-123", x: 320, y: 240 }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/feed");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok-123");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ x: 320, y: 240 });
  });

  it("실패 응답이면 서버의 code 를 담은 에러를 던진다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_food" } }),
    }));

    await expect(
      sendFeed({ token: "t", x: 1, y: 2 }, fetchImpl),
    ).rejects.toMatchObject({ code: "invalid_food" });
  });
});
