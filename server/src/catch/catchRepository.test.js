import { describe, it, expect } from "vitest";
import { InMemoryCatchRepository } from "./catchRepository.js";

// 수집(catch) 데이터 접근 계층 계약(repository interface)을 인메모리 구현으로 검증한다.
// 라이브 DB 없이 단위 테스트 가능해야 한다. 실제 PostgreSQL 구현은 이 계약을 따른다.
// 커버: REQ-SNAP-001(독립 스냅샷 저장), REQ-CATCH-005(dedupe 조회), REQ-COLL-001(본인 조회).

// 저장할 수집 스냅샷 레코드(내부 표현). 낚은 사람(catcherId)과 원본 참조(sourceFishId)를 갖는다.
function sampleCatch(overrides = {}) {
  return {
    catcherId: "catcher-1",
    sourceFishId: "11111111-1111-1111-1111-111111111111",
    drawing: { version: 1, width: 300, height: 200, strokes: [] },
    displayMode: "named",
    displayName: "홍길동",
    ...overrides,
  };
}

describe("InMemoryCatchRepository.create", () => {
  it("id 와 caughtAt 을 부여해 스냅샷을 저장하고 저장 레코드를 반환한다 (REQ-SNAP-001)", async () => {
    const repo = new InMemoryCatchRepository();
    const saved = await repo.create(sampleCatch());

    expect(saved.id).toBeTypeOf("string");
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved.caughtAt).toBeTypeOf("string");
    expect(Number.isNaN(Date.parse(saved.caughtAt))).toBe(false);
    expect(saved.catcherId).toBe("catcher-1");
    expect(saved.sourceFishId).toBe("11111111-1111-1111-1111-111111111111");
    expect(saved.displayMode).toBe("named");
    expect(saved.displayName).toBe("홍길동");
    expect(saved.drawing).toEqual(sampleCatch().drawing);
  });

  it("수집마다 고유한 id 를 부여한다", async () => {
    const repo = new InMemoryCatchRepository();
    const a = await repo.create(sampleCatch());
    const b = await repo.create(sampleCatch({ sourceFishId: "22222222" }));
    expect(a.id).not.toBe(b.id);
  });

  it("익명 물고기 스냅샷도 저장한다(displayName null)", async () => {
    const repo = new InMemoryCatchRepository();
    const saved = await repo.create(
      sampleCatch({ displayMode: "anonymous", displayName: null }),
    );
    expect(saved.displayMode).toBe("anonymous");
    expect(saved.displayName).toBeNull();
  });

  it("반환 레코드는 방어적 복사본이라 수정해도 내부 상태에 영향을 주지 않는다", async () => {
    const repo = new InMemoryCatchRepository();
    const saved = await repo.create(sampleCatch());
    saved.displayName = "변조";
    const [stored] = await repo.listByCatcher("catcher-1");
    expect(stored.displayName).toBe("홍길동");
  });
});

describe("InMemoryCatchRepository.listByCatcher", () => {
  it("해당 낚은 사람의 수집만 반환한다 (REQ-COLL-001, REQ-PRIV-003)", async () => {
    const repo = new InMemoryCatchRepository();
    await repo.create(sampleCatch({ catcherId: "A", sourceFishId: "f1" }));
    await repo.create(sampleCatch({ catcherId: "A", sourceFishId: "f2" }));
    await repo.create(sampleCatch({ catcherId: "B", sourceFishId: "f3" }));

    const mine = await repo.listByCatcher("A");
    expect(mine).toHaveLength(2);
    expect(mine.every((c) => c.catcherId === "A")).toBe(true);
  });

  it("낚은 게 없는 사람은 빈 배열을 반환한다 (REQ-COLL-005)", async () => {
    const repo = new InMemoryCatchRepository();
    expect(await repo.listByCatcher("nobody")).toEqual([]);
  });

  it("최신순(newest-first)으로 정렬해 반환한다", async () => {
    const repo = new InMemoryCatchRepository();
    const first = await repo.create(sampleCatch({ sourceFishId: "f1" }));
    const second = await repo.create(sampleCatch({ sourceFishId: "f2" }));
    const third = await repo.create(sampleCatch({ sourceFishId: "f3" }));

    const list = await repo.listByCatcher("catcher-1");
    expect(list.map((c) => c.id)).toEqual([third.id, second.id, first.id]);
  });

  it("반환 배열 수정이 내부 상태에 영향을 주지 않는다", async () => {
    const repo = new InMemoryCatchRepository();
    await repo.create(sampleCatch());
    const list = await repo.listByCatcher("catcher-1");
    list.pop();
    expect(await repo.listByCatcher("catcher-1")).toHaveLength(1);
  });
});

describe("InMemoryCatchRepository.findByCatcherAndSource", () => {
  it("동일 (catcherId, sourceFishId) 수집을 찾으면 반환한다 (REQ-CATCH-005)", async () => {
    const repo = new InMemoryCatchRepository();
    const saved = await repo.create(
      sampleCatch({ catcherId: "A", sourceFishId: "src-1" }),
    );
    const found = await repo.findByCatcherAndSource("A", "src-1");
    expect(found.id).toBe(saved.id);
  });

  it("다른 사람이 같은 원본을 낚은 것은 스코프가 달라 찾지 않는다 (REQ-PRIV-003)", async () => {
    const repo = new InMemoryCatchRepository();
    await repo.create(sampleCatch({ catcherId: "A", sourceFishId: "src-1" }));
    expect(await repo.findByCatcherAndSource("B", "src-1")).toBeNull();
  });

  it("수집한 적 없는 원본은 null 을 반환한다", async () => {
    const repo = new InMemoryCatchRepository();
    await repo.create(sampleCatch({ catcherId: "A", sourceFishId: "src-1" }));
    expect(await repo.findByCatcherAndSource("A", "src-2")).toBeNull();
  });
});
