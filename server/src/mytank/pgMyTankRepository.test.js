import { describe, it, expect } from "vitest";
import { PgMyTankRepository } from "./pgMyTankRepository.js";

// 얇은 PostgreSQL 구현 검증 — 라이브 DB 없이 가짜 pool 로 SQL/매핑/스코프를 확인한다.
// 소유권 스코프는 쿼리의 WHERE ... AND owner_id = $n 으로 강제된다(누출 없는 404 근거).

function fakePool(rows = [], rowCount) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows, rowCount: rowCount ?? rows.length };
    },
  };
}

const fishRow = {
  id: "11111111-1111-1111-1111-111111111111",
  owner_id: "owner-1",
  drawing: { version: 1, width: 300, height: 200, strokes: [] },
  display_mode: "named",
  display_name: "홍길동",
  x: 12.5,
  y: 34,
  scale: 1.5,
  created_at: new Date("2026-07-10T00:00:00.000Z"),
};

const decorRow = {
  id: "22222222-2222-2222-2222-222222222222",
  owner_id: "owner-1",
  kind: "seaweed",
  x: 5,
  y: 6,
  scale: 2.0,
  created_at: new Date("2026-07-10T00:00:00.000Z"),
};

describe("PgMyTankRepository — fish", () => {
  it("createFish 는 파라미터화 INSERT 를 실행하고 행을 camelCase 로 매핑한다", async () => {
    const pool = fakePool([fishRow]);
    const repo = new PgMyTankRepository(pool);
    const saved = await repo.createFish({
      ownerId: "owner-1",
      drawing: fishRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
      x: 12.5,
      y: 34,
    });
    expect(pool.calls[0].text.toUpperCase()).toContain("INSERT INTO MY_TANK_FISH");
    expect(pool.calls[0].params).toContain("owner-1");
    expect(saved).toEqual({
      id: fishRow.id,
      ownerId: "owner-1",
      drawing: fishRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
      x: 12.5,
      y: 34,
      scale: 1.5,
      createdAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("createFish 는 scale 을 INSERT 컬럼/파라미터로 포함한다", async () => {
    const pool = fakePool([fishRow]);
    const repo = new PgMyTankRepository(pool);
    await repo.createFish({
      ownerId: "owner-1",
      drawing: fishRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
      x: 12.5,
      y: 34,
      scale: 1.5,
    });
    expect(pool.calls[0].text.toUpperCase()).toContain("SCALE");
    expect(pool.calls[0].params).toContain(1.5);
  });

  it("createFish 는 scale 이 없으면 기본값 1.0 을 INSERT 파라미터로 넣는다", async () => {
    const pool = fakePool([fishRow]);
    const repo = new PgMyTankRepository(pool);
    await repo.createFish({
      ownerId: "owner-1",
      drawing: fishRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
      x: 12.5,
      y: 34,
    });
    expect(pool.calls[0].params).toContain(1.0);
  });

  it("updateFishPosition 은 scale 이 주어지면 SET 절에 scale 을 포함한다", async () => {
    const pool = fakePool([{ ...fishRow, x: 99, y: 88, scale: 2.5 }]);
    const repo = new PgMyTankRepository(pool);
    const updated = await repo.updateFishPosition({ id: fishRow.id, ownerId: "owner-1", x: 99, y: 88, scale: 2.5 });
    expect(pool.calls[0].text.toUpperCase()).toContain("SCALE");
    expect(pool.calls[0].params).toContain(2.5);
    expect(updated.scale).toBe(2.5);
  });

  it("updateFishPosition 은 scale 이 없으면 SET 절에서 scale 을 건드리지 않는다", async () => {
    const pool = fakePool([{ ...fishRow, x: 99, y: 88 }]);
    const repo = new PgMyTankRepository(pool);
    await repo.updateFishPosition({ id: fishRow.id, ownerId: "owner-1", x: 99, y: 88 });
    expect(pool.calls[0].text.toUpperCase()).not.toContain("SET X = $3, Y = $4, SCALE");
    expect(pool.calls[0].params).toEqual([fishRow.id, "owner-1", 99, 88]);
  });

  it("listFishByOwner 는 owner_id 로 스코프된 SELECT 를 실행한다", async () => {
    const pool = fakePool([fishRow]);
    const repo = new PgMyTankRepository(pool);
    const all = await repo.listFishByOwner("owner-1");
    expect(pool.calls[0].text.toUpperCase()).toContain("WHERE OWNER_ID = $1");
    expect(pool.calls[0].params).toEqual(["owner-1"]);
    expect(all).toHaveLength(1);
    expect(all[0].ownerId).toBe("owner-1");
  });

  it("updateFishPosition 은 id 와 owner_id 를 함께 조건으로 걸고 갱신본을 매핑한다", async () => {
    const pool = fakePool([{ ...fishRow, x: 99, y: 88 }]);
    const repo = new PgMyTankRepository(pool);
    const updated = await repo.updateFishPosition({ id: fishRow.id, ownerId: "owner-1", x: 99, y: 88 });
    const sql = pool.calls[0].text.toUpperCase();
    expect(sql).toContain("UPDATE MY_TANK_FISH");
    expect(sql).toContain("OWNER_ID = $");
    expect(pool.calls[0].params).toContain("owner-1");
    expect(pool.calls[0].params).toContain(fishRow.id);
    expect(updated.x).toBe(99);
    expect(updated.y).toBe(88);
  });

  it("updateFishPosition 은 매칭 행이 없으면(타인/미존재) null 을 반환한다", async () => {
    const pool = fakePool([]);
    const repo = new PgMyTankRepository(pool);
    expect(await repo.updateFishPosition({ id: "x", ownerId: "owner-1", x: 1, y: 1 })).toBeNull();
  });

  it("deleteFish 는 id+owner_id 파라미터화 DELETE 로 rowCount 기반 결과를 낸다", async () => {
    const pool = fakePool([], 1);
    const repo = new PgMyTankRepository(pool);
    const removed = await repo.deleteFish({ id: fishRow.id, ownerId: "owner-1" });
    const sql = pool.calls[0].text.toUpperCase();
    expect(sql).toContain("DELETE FROM MY_TANK_FISH");
    expect(sql).toContain("OWNER_ID = $");
    expect(pool.calls[0].params).toEqual([fishRow.id, "owner-1"]);
    expect(removed).toBe(true);
  });

  it("deleteFish 는 매칭 행이 없으면(rowCount 0) false 를 반환한다", async () => {
    const pool = fakePool([], 0);
    const repo = new PgMyTankRepository(pool);
    expect(await repo.deleteFish({ id: "x", ownerId: "owner-1" })).toBe(false);
  });
});

describe("PgMyTankRepository — decor", () => {
  it("createDecor 는 파라미터화 INSERT 를 실행하고 행을 camelCase 로 매핑한다", async () => {
    const pool = fakePool([decorRow]);
    const repo = new PgMyTankRepository(pool);
    const saved = await repo.createDecor({ ownerId: "owner-1", kind: "seaweed", x: 5, y: 6 });
    expect(pool.calls[0].text.toUpperCase()).toContain("INSERT INTO MY_TANK_DECOR");
    expect(pool.calls[0].params).toContain("seaweed");
    expect(saved).toEqual({
      id: decorRow.id,
      ownerId: "owner-1",
      kind: "seaweed",
      x: 5,
      y: 6,
      scale: 2.0,
      createdAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("createDecor 는 scale 을 INSERT 컬럼/파라미터로 포함한다 (기본값 1.0)", async () => {
    const pool = fakePool([decorRow]);
    const repo = new PgMyTankRepository(pool);
    await repo.createDecor({ ownerId: "owner-1", kind: "seaweed", x: 5, y: 6 });
    expect(pool.calls[0].text.toUpperCase()).toContain("SCALE");
    expect(pool.calls[0].params).toContain(1.0);
  });

  it("updateDecorPosition 은 scale 이 주어지면 SET 절에 scale 을 포함하고 갱신본을 매핑한다", async () => {
    const pool = fakePool([{ ...decorRow, x: 50, y: 60, scale: 0.5 }]);
    const repo = new PgMyTankRepository(pool);
    const updated = await repo.updateDecorPosition({ id: decorRow.id, ownerId: "owner-1", x: 50, y: 60, scale: 0.5 });
    expect(pool.calls[0].text.toUpperCase()).toContain("SCALE");
    expect(pool.calls[0].params).toContain(0.5);
    expect(updated.scale).toBe(0.5);
  });

  it("listDecorByOwner 는 owner_id 로 스코프된 SELECT 를 실행한다", async () => {
    const pool = fakePool([decorRow]);
    const repo = new PgMyTankRepository(pool);
    const all = await repo.listDecorByOwner("owner-1");
    expect(pool.calls[0].text.toUpperCase()).toContain("WHERE OWNER_ID = $1");
    expect(pool.calls[0].params).toEqual(["owner-1"]);
    expect(all[0].kind).toBe("seaweed");
  });

  it("updateDecorPosition 은 id+owner_id 를 조건으로 걸고, 없으면 null 을 반환한다", async () => {
    const pool = fakePool([{ ...decorRow, x: 50, y: 60 }]);
    const repo = new PgMyTankRepository(pool);
    const updated = await repo.updateDecorPosition({ id: decorRow.id, ownerId: "owner-1", x: 50, y: 60 });
    expect(pool.calls[0].text.toUpperCase()).toContain("UPDATE MY_TANK_DECOR");
    expect(updated.x).toBe(50);

    const empty = fakePool([]);
    const repo2 = new PgMyTankRepository(empty);
    expect(await repo2.updateDecorPosition({ id: "x", ownerId: "owner-1", x: 0, y: 0 })).toBeNull();
  });

  it("deleteDecor 는 id+owner_id 파라미터화 DELETE 로 rowCount 기반 결과를 낸다", async () => {
    const pool = fakePool([], 1);
    const repo = new PgMyTankRepository(pool);
    expect(await repo.deleteDecor({ id: decorRow.id, ownerId: "owner-1" })).toBe(true);
    expect(pool.calls[0].params).toEqual([decorRow.id, "owner-1"]);

    const none = fakePool([], 0);
    const repo2 = new PgMyTankRepository(none);
    expect(await repo2.deleteDecor({ id: "x", ownerId: "owner-1" })).toBe(false);
  });
});
