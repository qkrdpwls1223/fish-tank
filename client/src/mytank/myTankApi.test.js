import { describe, it, expect, vi } from "vitest";
import {
  fetchMyTank,
  createMyTankFish,
  moveMyTankFish,
  deleteMyTankFish,
  createMyTankDecor,
  moveMyTankDecor,
  deleteMyTankDecor,
} from "./myTankApi.js";

// 내 어항 API 클라이언트. Bearer 토큰을 실어 호출자 스코프로 요청하고, 에러는 { error:{ code } }
// 형태에서 code 를 추출한다(fishApi 규약과 동일). 네트워크 없이 요청 형태/헤더/에러를 검증한다.

const drawing = { version: 1, width: 300, height: 200, strokes: [] };

function okFetch(body, status = 200) {
  return vi.fn(async () => ({ ok: true, status, json: async () => body }));
}
function errFetch(status, code) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ error: { code } }),
  }));
}

describe("fetchMyTank", () => {
  it("Bearer 토큰으로 GET /api/my-tank 를 호출한다", async () => {
    const fetchImpl = okFetch({ fish: [], decor: [] });
    await fetchMyTank({ token: "tok-1" }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank");
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer tok-1");
  });

  it("성공 시 {fish, decor} 를 반환한다", async () => {
    const data = { fish: [{ id: "f1" }], decor: [{ id: "d1", kind: "rock" }] };
    const result = await fetchMyTank({ token: "t" }, okFetch(data));
    expect(result).toEqual(data);
  });

  it("실패 응답이면 code 를 담은 에러를 던진다", async () => {
    await expect(
      fetchMyTank({ token: "t" }, errFetch(401, "unauthorized")),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("createMyTankFish", () => {
  it("그림/표시모드/위치를 담아 POST /api/my-tank/fish 를 호출한다(서버가 displayName 파생)", async () => {
    const fetchImpl = okFetch({ id: "f1" }, 201);
    await createMyTankFish(
      { token: "tok-9", drawing, displayMode: "named", x: 40, y: 60 },
      fetchImpl,
    );

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank/fish");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok-9");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    // 신원(displayName)은 보내지 않고 표시모드만 보낸다.
    expect(JSON.parse(opts.body)).toEqual({
      drawing,
      displayMode: "named",
      x: 40,
      y: 60,
    });
  });

  it("성공 시 생성된 물고기를 반환한다", async () => {
    const created = { id: "f1", x: 40, y: 60, displayMode: "anonymous" };
    const result = await createMyTankFish(
      { token: "t", drawing, displayMode: "anonymous", x: 40, y: 60 },
      okFetch(created, 201),
    );
    expect(result).toEqual(created);
  });

  it("그림/위치 검증 실패(400)면 code 를 담은 에러를 던진다", async () => {
    await expect(
      createMyTankFish(
        { token: "t", drawing, displayMode: "named", x: -1, y: 0 },
        errFetch(400, "invalid_position"),
      ),
    ).rejects.toMatchObject({ code: "invalid_position" });
  });
});

describe("moveMyTankFish", () => {
  it("새 좌표로 PATCH /api/my-tank/fish/:id 를 호출한다", async () => {
    const fetchImpl = okFetch({ id: "f1", x: 10, y: 20 });
    await moveMyTankFish({ token: "t", id: "f1", x: 10, y: 20 }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank/fish/f1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ x: 10, y: 20 });
  });

  it("scale 을 주면 x,y 와 함께 PATCH 본문에 싣는다", async () => {
    const fetchImpl = okFetch({ id: "f1", x: 10, y: 20, scale: 1.2 });
    await moveMyTankFish({ token: "t", id: "f1", x: 10, y: 20, scale: 1.2 }, fetchImpl);

    const [, opts] = fetchImpl.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ x: 10, y: 20, scale: 1.2 });
  });

  it("scale 을 주지 않으면 본문에 scale 키가 없다(기존 동작 유지)", async () => {
    const fetchImpl = okFetch({ id: "f1", x: 10, y: 20 });
    await moveMyTankFish({ token: "t", id: "f1", x: 10, y: 20 }, fetchImpl);

    const [, opts] = fetchImpl.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ x: 10, y: 20 });
    expect("scale" in body).toBe(false);
  });

  it("본인 것이 아니면(404) 에러를 던진다", async () => {
    await expect(
      moveMyTankFish({ token: "t", id: "x", x: 1, y: 2 }, errFetch(404, "not_found")),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("deleteMyTankFish", () => {
  it("DELETE /api/my-tank/fish/:id 를 호출한다(204)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    await deleteMyTankFish({ token: "t", id: "f9" }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank/fish/f9");
    expect(opts.method).toBe("DELETE");
    expect(opts.headers.Authorization).toBe("Bearer t");
  });

  it("실패 시 에러를 던진다", async () => {
    await expect(
      deleteMyTankFish({ token: "t", id: "x" }, errFetch(404, "not_found")),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("createMyTankDecor", () => {
  it("kind/위치를 담아 POST /api/my-tank/decor 를 호출한다", async () => {
    const fetchImpl = okFetch({ id: "d1", kind: "seaweed", x: 5, y: 6 }, 201);
    await createMyTankDecor(
      { token: "t", kind: "seaweed", x: 5, y: 6 },
      fetchImpl,
    );

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank/decor");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ kind: "seaweed", x: 5, y: 6 });
  });

  it("잘못된 kind(400 invalid_kind)면 에러를 던진다", async () => {
    await expect(
      createMyTankDecor({ token: "t", kind: "nope", x: 0, y: 0 }, errFetch(400, "invalid_kind")),
    ).rejects.toMatchObject({ code: "invalid_kind" });
  });
});

describe("moveMyTankDecor", () => {
  it("새 좌표로 PATCH /api/my-tank/decor/:id 를 호출한다", async () => {
    const fetchImpl = okFetch({ id: "d1", x: 9, y: 9 });
    await moveMyTankDecor({ token: "t", id: "d1", x: 9, y: 9 }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank/decor/d1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toEqual({ x: 9, y: 9 });
  });

  it("scale 을 주면 x,y 와 함께 PATCH 본문에 싣는다", async () => {
    const fetchImpl = okFetch({ id: "d1", x: 9, y: 9, scale: 0.8 });
    await moveMyTankDecor({ token: "t", id: "d1", x: 9, y: 9, scale: 0.8 }, fetchImpl);

    const [, opts] = fetchImpl.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ x: 9, y: 9, scale: 0.8 });
  });
});

describe("deleteMyTankDecor", () => {
  it("DELETE /api/my-tank/decor/:id 를 호출한다(204)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }));
    await deleteMyTankDecor({ token: "t", id: "d5" }, fetchImpl);

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/my-tank/decor/d5");
    expect(opts.method).toBe("DELETE");
  });
});
