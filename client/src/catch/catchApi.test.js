import { describe, it, expect, vi } from "vitest";
import { catchFish, fetchCatches } from "./catchApi.js";

// 낚시 API 클라이언트. 인증 토큰을 Bearer 로 실어 서버에 전송하고, 서버 응답을 그대로 돌려준다.
// 커버: REQ-CATCH-001/004/005(낚기), REQ-COLL-001(수집함 조회), NFR-SEC-001/002(토큰/본문 없음).

// 지정한 status/body 로 응답하는 가짜 fetch.
function fakeFetch({ ok, status, body }) {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

describe("catchFish", () => {
  it("본문 없이 Bearer 토큰으로 POST /api/fish/:id/catch 를 호출한다 (NFR-SEC-001/002)", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      status: 201,
      body: { id: "catch-1", alreadyCollected: false },
    });
    await catchFish({ token: "tok-123", id: "fish-9" }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/fish/fish-9/catch");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok-123");
    // 스냅샷은 서버가 원본에서 유도하므로 클라이언트는 그림 본문을 보내지 않는다(NFR-SEC-002).
    expect(opts.body).toBeUndefined();
  });

  it("신규 낚기(201)면 alreadyCollected=false 스냅샷을 돌려준다 (REQ-CATCH-001)", async () => {
    const snapshot = {
      id: "catch-1",
      sourceFishId: "fish-9",
      drawing: { version: 1, width: 300, height: 200, strokes: [] },
      displayMode: "named",
      displayName: "구피",
      caughtAt: "2026-07-10T12:00:00.000Z",
      alreadyCollected: false,
    };
    const result = await catchFish(
      { token: "t", id: "fish-9" },
      fakeFetch({ ok: true, status: 201, body: snapshot }),
    );
    expect(result).toEqual(snapshot);
    expect(result.alreadyCollected).toBe(false);
  });

  it("중복 낚기(200)면 alreadyCollected=true 로 멱등 처리됨을 알린다 (REQ-CATCH-005)", async () => {
    const result = await catchFish(
      { token: "t", id: "fish-9" },
      fakeFetch({
        ok: true,
        status: 200,
        body: { id: "catch-1", sourceFishId: "fish-9", alreadyCollected: true },
      }),
    );
    expect(result.alreadyCollected).toBe(true);
  });

  it("없는 물고기(404)면 code=not_found 를 담은 에러를 던진다 (REQ-CATCH-004)", async () => {
    const fetchImpl = fakeFetch({
      ok: false,
      status: 404,
      body: { error: { code: "not_found" } },
    });
    await expect(
      catchFish({ token: "t", id: "gone" }, fetchImpl),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("미인증(401)이면 에러를 던진다", async () => {
    const fetchImpl = fakeFetch({
      ok: false,
      status: 401,
      body: { error: { code: "unauthorized" } },
    });
    await expect(
      catchFish({ token: "t", id: "x" }, fetchImpl),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("fetchCatches", () => {
  it("Bearer 토큰으로 GET /api/me/catches 를 호출한다 (REQ-COLL-001, NFR-SEC-001)", async () => {
    const fetchImpl = fakeFetch({ ok: true, status: 200, body: [] });
    await fetchCatches({ token: "tok-xyz" }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/me/catches");
    expect(opts.method ?? "GET").toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer tok-xyz");
  });

  it("성공 시 낚은 스냅샷 배열을 그대로(최신순) 반환한다 (REQ-COLL-004)", async () => {
    const catches = [
      { id: "c2", caughtAt: "2026-07-10T12:00:00.000Z" },
      { id: "c1", caughtAt: "2026-07-09T12:00:00.000Z" },
    ];
    const result = await fetchCatches(
      { token: "t" },
      fakeFetch({ ok: true, status: 200, body: catches }),
    );
    expect(result).toEqual(catches);
  });

  it("낚은 물고기가 없으면 빈 배열을 반환한다 (REQ-COLL-005)", async () => {
    const result = await fetchCatches(
      { token: "t" },
      fakeFetch({ ok: true, status: 200, body: [] }),
    );
    expect(result).toEqual([]);
  });

  it("미인증(401)이면 에러를 던진다 (REQ-PRIV-003)", async () => {
    const fetchImpl = fakeFetch({
      ok: false,
      status: 401,
      body: { error: { code: "unauthorized" } },
    });
    await expect(
      fetchCatches({ token: "t" }, fetchImpl),
    ).rejects.toBeInstanceOf(Error);
  });
});
