import { describe, it, expect } from "vitest";
import { PgCatchRepository } from "./pgCatchRepository.js";

// 얇은 PostgreSQL 수집 저장소 검증 — 라이브 DB 없이 가짜 pool 로 SQL/매핑을 확인한다.
// 커버: REQ-SNAP-001/003(독립 스냅샷), REQ-CATCH-005(dedupe), REQ-COLL-001(본인 스코프), NFR-SEC-003(파라미터화).

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
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  catcher_id: "catcher-1",
  source_fish_id: "11111111-1111-1111-1111-111111111111",
  drawing: { version: 1, width: 300, height: 200, strokes: [] },
  display_mode: "named",
  display_name: "홍길동",
  caught_at: new Date("2026-07-10T00:00:00.000Z"),
};

describe("PgCatchRepository.create", () => {
  it("INSERT 를 실행하고 저장 행을 내부 형식(camelCase)으로 매핑한다 (REQ-SNAP-001)", async () => {
    const pool = fakePool([dbRow]);
    const repo = new PgCatchRepository(pool);

    const saved = await repo.create({
      catcherId: "catcher-1",
      sourceFishId: dbRow.source_fish_id,
      drawing: dbRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
    });

    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].text.toUpperCase()).toContain("INSERT INTO");
    // 파라미터화 쿼리로 값 전달(주입 방지, NFR-SEC-003).
    expect(pool.calls[0].params).toContain("catcher-1");
    expect(pool.calls[0].params).toContain(dbRow.source_fish_id);

    expect(saved).toEqual({
      id: dbRow.id,
      catcherId: "catcher-1",
      sourceFishId: dbRow.source_fish_id,
      drawing: dbRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
      caughtAt: "2026-07-10T00:00:00.000Z",
    });
  });

  it("INSERT 에 ON CONFLICT DO NOTHING 을 사용한다 (REQ-CATCH-005, 레이스 안전)", async () => {
    const pool = fakePool([dbRow]);
    const repo = new PgCatchRepository(pool);

    await repo.create({
      catcherId: "catcher-1",
      sourceFishId: dbRow.source_fish_id,
      drawing: dbRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
    });

    const insertText = pool.calls[0].text.toUpperCase();
    expect(insertText).toContain("ON CONFLICT");
    expect(insertText).toContain("DO NOTHING");
  });

  it("INSERT 가 0행을 반환하면(충돌) 폴백 SELECT 로 기존 행을 반환한다 (REQ-CATCH-005)", async () => {
    // 순차 응답 pool: 첫 쿼리(INSERT ON CONFLICT)는 0행, 둘째 쿼리(폴백 SELECT)는 기존 행.
    const calls = [];
    const responses = [{ rows: [] }, { rows: [dbRow] }];
    const pool = {
      calls,
      query: async (text, params) => {
        calls.push({ text, params });
        return responses.shift();
      },
    };
    const repo = new PgCatchRepository(pool);

    const saved = await repo.create({
      catcherId: "catcher-1",
      sourceFishId: dbRow.source_fish_id,
      drawing: dbRow.drawing,
      displayMode: "named",
      displayName: "홍길동",
    });

    // create 계약: 충돌 시에도 항상 영속된 행(기존 행)을 반환한다.
    expect(saved.id).toBe(dbRow.id);
    expect(saved.sourceFishId).toBe(dbRow.source_fish_id);
    // 두 번째 쿼리는 폴백 SELECT 여야 한다.
    expect(calls).toHaveLength(2);
    expect(calls[1].text.toUpperCase()).toContain("SELECT");
    expect(calls[1].params).toEqual(["catcher-1", dbRow.source_fish_id]);
  });

  it("익명 물고기 스냅샷은 display_name 을 null 로 저장한다", async () => {
    const anonRow = { ...dbRow, display_mode: "anonymous", display_name: null };
    const pool = fakePool([anonRow]);
    const repo = new PgCatchRepository(pool);

    const saved = await repo.create({
      catcherId: "catcher-1",
      sourceFishId: dbRow.source_fish_id,
      drawing: dbRow.drawing,
      displayMode: "anonymous",
      displayName: null,
    });

    expect(saved.displayMode).toBe("anonymous");
    expect(saved.displayName).toBeNull();
  });
});

describe("PgCatchRepository.listByCatcher", () => {
  it("catcher_id 로 SELECT 하고 caught_at DESC 로 정렬해 매핑한다 (REQ-COLL-001)", async () => {
    const pool = fakePool([dbRow, { ...dbRow, id: "bbbbbbbb" }]);
    const repo = new PgCatchRepository(pool);

    const all = await repo.listByCatcher("catcher-1");
    const text = pool.calls[0].text.toUpperCase();
    expect(text).toContain("SELECT");
    expect(text).toContain("WHERE CATCHER_ID = $1");
    expect(text).toContain("ORDER BY CAUGHT_AT DESC");
    // 파라미터화 스코프(NFR-SEC-003, REQ-PRIV-003).
    expect(pool.calls[0].params).toEqual(["catcher-1"]);
    expect(all).toHaveLength(2);
    expect(all[0].catcherId).toBe("catcher-1");
    expect(all[0].caughtAt).toBe("2026-07-10T00:00:00.000Z");
  });
});

describe("PgCatchRepository.findByCatcherAndSource", () => {
  it("(catcher_id, source_fish_id) 로 SELECT 하고 행을 매핑한다 (REQ-CATCH-005)", async () => {
    const pool = fakePool([dbRow]);
    const repo = new PgCatchRepository(pool);

    const found = await repo.findByCatcherAndSource(
      "catcher-1",
      dbRow.source_fish_id,
    );
    expect(pool.calls[0].text.toUpperCase()).toContain("SELECT");
    // 파라미터화 쿼리로 두 스코프 값 전달(주입 방지).
    expect(pool.calls[0].params).toEqual(["catcher-1", dbRow.source_fish_id]);
    expect(found.id).toBe(dbRow.id);
    expect(found.sourceFishId).toBe(dbRow.source_fish_id);
  });

  it("행이 없으면 null 을 반환한다", async () => {
    const pool = fakePool([]);
    const repo = new PgCatchRepository(pool);
    expect(await repo.findByCatcherAndSource("catcher-1", "no-src")).toBeNull();
  });
});
