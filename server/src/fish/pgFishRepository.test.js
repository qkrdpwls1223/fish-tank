import { describe, it, expect } from "vitest";
import { PgFishRepository } from "./pgFishRepository.js";

// 얇은 PostgreSQL 구현 검증 — 라이브 DB 없이 가짜 pool 로 SQL/매핑을 확인한다.
// 실제 DB 연결은 통합/수동 검증 영역이며, 여기서는 계약 준수와 행 매핑만 본다.

// 가짜 pg pool: 마지막 쿼리를 기록하고 미리 정한 rows 를 반환한다.
function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows };
    },
  };
}

// DB 행(snake_case) 형태.
const dbRow = {
  id: "11111111-1111-1111-1111-111111111111",
  drawing: { version: 1, width: 300, height: 200, strokes: [] },
  owner_id: "owner-1",
  display_mode: "named",
  display_name: "홍길동",
  created_at: new Date("2026-07-09T00:00:00.000Z"),
};

describe("PgFishRepository.create", () => {
  it("INSERT 를 실행하고 저장 행을 내부 형식(camelCase)으로 매핑한다", async () => {
    const pool = fakePool([dbRow]);
    const repo = new PgFishRepository(pool);

    const saved = await repo.create({
      drawing: dbRow.drawing,
      ownerId: "owner-1",
      displayMode: "named",
      displayName: "홍길동",
    });

    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].text.toUpperCase()).toContain("INSERT INTO");
    // 파라미터화 쿼리로 값 전달(주입 방지) — ownerId 가 파라미터에 포함.
    expect(pool.calls[0].params).toContain("owner-1");

    expect(saved).toEqual({
      id: dbRow.id,
      drawing: dbRow.drawing,
      ownerId: "owner-1",
      displayMode: "named",
      displayName: "홍길동",
      createdAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("익명 물고기는 display_name 을 null 로 저장한다 (REQ-OWN-001)", async () => {
    const anonRow = { ...dbRow, display_mode: "anonymous", display_name: null };
    const pool = fakePool([anonRow]);
    const repo = new PgFishRepository(pool);

    const saved = await repo.create({
      drawing: dbRow.drawing,
      ownerId: "owner-1",
      displayMode: "anonymous",
      displayName: null,
    });

    expect(saved.displayMode).toBe("anonymous");
    expect(saved.displayName).toBeNull();
    expect(saved.ownerId).toBe("owner-1");
  });
});

describe("PgFishRepository.list", () => {
  it("SELECT 를 실행하고 모든 행을 내부 형식으로 매핑한다", async () => {
    const pool = fakePool([dbRow, { ...dbRow, id: "22222222" }]);
    const repo = new PgFishRepository(pool);

    const all = await repo.list();
    expect(pool.calls[0].text.toUpperCase()).toContain("SELECT");
    expect(all).toHaveLength(2);
    expect(all[0].ownerId).toBe("owner-1");
    expect(all[0].createdAt).toBe("2026-07-09T00:00:00.000Z");
  });
});

// M4: 소유권 검증용 단건 조회 (REQ-OWN-002/003).
describe("PgFishRepository.findById", () => {
  it("id 로 SELECT 하고 행을 내부 형식(ownerId 포함)으로 매핑한다", async () => {
    const pool = fakePool([dbRow]);
    const repo = new PgFishRepository(pool);

    const found = await repo.findById(dbRow.id);
    expect(pool.calls[0].text.toUpperCase()).toContain("SELECT");
    // 파라미터화 쿼리로 id 전달(주입 방지, NFR-SEC-003).
    expect(pool.calls[0].params).toEqual([dbRow.id]);
    expect(found.id).toBe(dbRow.id);
    expect(found.ownerId).toBe("owner-1");
  });

  it("행이 없으면 null 을 반환한다", async () => {
    const pool = fakePool([]);
    const repo = new PgFishRepository(pool);
    expect(await repo.findById("no-such-id")).toBeNull();
  });
});

// M4: 삭제 (REQ-OWN-002). rowCount 로 삭제 여부를 판단한다.
describe("PgFishRepository.delete", () => {
  it("DELETE 를 파라미터화 쿼리로 실행하고 삭제되면 true 를 반환한다", async () => {
    const pool = {
      calls: [],
      query: async (text, params) => {
        pool.calls.push({ text, params });
        return { rows: [], rowCount: 1 };
      },
    };
    const repo = new PgFishRepository(pool);

    const removed = await repo.delete(dbRow.id);
    expect(pool.calls[0].text.toUpperCase()).toContain("DELETE");
    expect(pool.calls[0].params).toEqual([dbRow.id]);
    expect(removed).toBe(true);
  });

  it("삭제 대상이 없으면(rowCount 0) false 를 반환한다", async () => {
    const pool = {
      calls: [],
      query: async () => ({ rows: [], rowCount: 0 }),
    };
    const repo = new PgFishRepository(pool);
    expect(await repo.delete("missing")).toBe(false);
  });
});
