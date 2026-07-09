import { describe, it, expect, vi } from "vitest";
import { submitFish, fetchFishSnapshot, deleteFish } from "./fishApi.js";

// 물고기 생성 API 클라이언트. 인증 토큰을 Bearer 로 실어 서버에 전송한다.
// 커버: REQ-DRAW-003(등록 전송), NFR-SEC-001(토큰 전달).

const drawing = { version: 1, width: 300, height: 200, strokes: [] };

// 201 응답을 흉내내는 가짜 fetch.
function okFetch(body) {
  return vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => body,
  }));
}

describe("submitFish", () => {
  it("Bearer 토큰과 그림/표시모드를 담아 POST /api/fish 를 호출한다", async () => {
    const fetchImpl = okFetch({ id: "fish-1", displayMode: "named" });
    await submitFish(
      { token: "tok-123", drawing, displayMode: "named" },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/fish");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok-123");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ drawing, displayMode: "named" });
  });

  it("성공 시 서버가 반환한 공개 물고기를 돌려준다", async () => {
    const created = { id: "fish-1", displayMode: "anonymous", displayName: null };
    const result = await submitFish(
      { token: "t", drawing, displayMode: "anonymous" },
      okFetch(created),
    );
    expect(result).toEqual(created);
  });

  it("실패 응답이면 서버의 code/reason 을 담은 에러를 던진다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "invalid_drawing", reason: "empty" } }),
    }));

    await expect(
      submitFish({ token: "t", drawing, displayMode: "named" }, fetchImpl),
    ).rejects.toMatchObject({ code: "invalid_drawing", reason: "empty" });
  });
});

// 진입/재연결 시 전체 스냅샷 로드 (REQ-RT-004, REQ-RT-003).
describe("fetchFishSnapshot", () => {
  function okFetch(body) {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    }));
  }

  it("Bearer 토큰으로 GET /api/fish 를 호출한다 (NFR-SEC-001)", async () => {
    const fetchImpl = okFetch([]);
    await fetchFishSnapshot({ token: "tok-xyz" }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/fish");
    expect(opts.method ?? "GET").toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer tok-xyz");
  });

  it("성공 시 물고기 배열을 반환한다 (REQ-RT-004)", async () => {
    const fishList = [
      { id: "a", displayMode: "named", displayName: "구피" },
      { id: "b", displayMode: "anonymous", displayName: null },
    ];
    const result = await fetchFishSnapshot({ token: "t" }, okFetch(fishList));
    expect(result).toEqual(fishList);
  });

  it("실패 응답이면 에러를 던진다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "unauthorized" } }),
    }));
    await expect(
      fetchFishSnapshot({ token: "t" }, fetchImpl),
    ).rejects.toBeInstanceOf(Error);
  });
});

// M4: 본인 물고기 삭제 요청 (REQ-OWN-002). 서버가 소유권을 검증한다(NFR-SEC-002).
describe("deleteFish", () => {
  function okDelete() {
    // 204 No Content: 본문 없음.
    return vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
  }

  it("Bearer 토큰으로 DELETE /api/fish/:id 를 호출한다 (NFR-SEC-001)", async () => {
    const fetchImpl = okDelete();
    await deleteFish({ token: "tok-9", id: "fish-42" }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/fish/fish-42");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers.Authorization).toBe("Bearer tok-9");
  });

  it("성공(2xx)하면 예외 없이 완료된다", async () => {
    await expect(
      deleteFish({ token: "t", id: "x" }, okDelete()),
    ).resolves.not.toThrow();
  });

  it("권한 없음(403)이면 code 를 담은 에러를 던진다 (REQ-OWN-003)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: "forbidden" } }),
    }));
    await expect(
      deleteFish({ token: "t", id: "x" }, fetchImpl),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("없는 물고기(404)면 에러를 던진다", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found" } }),
    }));
    await expect(
      deleteFish({ token: "t", id: "x" }, fetchImpl),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
