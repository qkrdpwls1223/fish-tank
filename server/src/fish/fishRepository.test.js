import { describe, it, expect } from "vitest";
import { InMemoryFishRepository } from "./fishRepository.js";

// 데이터 접근 계층 계약(repository interface)을 인메모리 구현으로 검증한다.
// 라이브 DB 없이 단위 테스트 가능해야 한다. 실제 PostgreSQL 구현은 이 계약을 따른다.

// 저장할 물고기 레코드(내부 표현). owner_id 는 내부 소유자(REQ-OWN-001).
function sampleRecord(overrides = {}) {
  return {
    drawing: { version: 1, width: 300, height: 200, strokes: [] },
    ownerId: "owner-1",
    displayMode: "named",
    displayName: "홍길동",
    ...overrides,
  };
}

describe("InMemoryFishRepository.create", () => {
  it("id 와 createdAt 을 부여해 저장하고 저장 레코드를 반환한다", async () => {
    const repo = new InMemoryFishRepository();
    const saved = await repo.create(sampleRecord());

    expect(saved.id).toBeTypeOf("string");
    expect(saved.id.length).toBeGreaterThan(0);
    expect(saved.createdAt).toBeTypeOf("string");
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
    expect(saved.ownerId).toBe("owner-1");
    expect(saved.displayMode).toBe("named");
    expect(saved.displayName).toBe("홍길동");
  });

  it("생성된 물고기마다 고유한 id 를 부여한다", async () => {
    const repo = new InMemoryFishRepository();
    const a = await repo.create(sampleRecord());
    const b = await repo.create(sampleRecord());
    expect(a.id).not.toBe(b.id);
  });

  it("익명 물고기도 내부 ownerId 를 저장한다 (REQ-OWN-001)", async () => {
    const repo = new InMemoryFishRepository();
    const saved = await repo.create(
      sampleRecord({ displayMode: "anonymous", displayName: null }),
    );
    expect(saved.ownerId).toBe("owner-1");
    expect(saved.displayMode).toBe("anonymous");
    expect(saved.displayName).toBeNull();
  });
});

describe("InMemoryFishRepository.list", () => {
  it("저장된 모든 물고기를 반환한다 (REQ-PERSIST-002 표시 근거)", async () => {
    const repo = new InMemoryFishRepository();
    await repo.create(sampleRecord({ ownerId: "a" }));
    await repo.create(sampleRecord({ ownerId: "b" }));
    const all = await repo.list();
    expect(all).toHaveLength(2);
  });

  it("빈 저장소는 빈 배열을 반환한다", async () => {
    const repo = new InMemoryFishRepository();
    expect(await repo.list()).toEqual([]);
  });

  it("반환된 배열 수정이 내부 상태에 영향을 주지 않는다", async () => {
    const repo = new InMemoryFishRepository();
    await repo.create(sampleRecord());
    const first = await repo.list();
    first.pop();
    expect(await repo.list()).toHaveLength(1);
  });
});

// M4: 소유권 검증에 필요한 단건 조회. 내부 ownerId 를 포함해 반환한다
// (삭제 권한 검증 전용, REQ-OWN-002/003).
describe("InMemoryFishRepository.findById", () => {
  it("존재하는 물고기를 내부 ownerId 포함으로 반환한다 (REQ-OWN-002/003)", async () => {
    const repo = new InMemoryFishRepository();
    const saved = await repo.create(sampleRecord({ ownerId: "owner-x" }));
    const found = await repo.findById(saved.id);
    expect(found.id).toBe(saved.id);
    expect(found.ownerId).toBe("owner-x");
  });

  it("익명 물고기도 내부 ownerId 로 조회된다 (REQ-OWN-001)", async () => {
    const repo = new InMemoryFishRepository();
    const saved = await repo.create(
      sampleRecord({ displayMode: "anonymous", displayName: null, ownerId: "anon-owner" }),
    );
    const found = await repo.findById(saved.id);
    expect(found.ownerId).toBe("anon-owner");
  });

  it("존재하지 않는 id 는 null 을 반환한다", async () => {
    const repo = new InMemoryFishRepository();
    expect(await repo.findById("nope")).toBeNull();
  });
});

// M4: 본인 물고기 삭제 (REQ-OWN-002). 소유권 검증은 상위 라우트가 담당하고
// 여기서는 저장소에서 제거만 얇게 수행한다.
describe("InMemoryFishRepository.delete", () => {
  it("존재하는 물고기를 삭제하고 true 를 반환한다 (REQ-OWN-002)", async () => {
    const repo = new InMemoryFishRepository();
    const saved = await repo.create(sampleRecord());
    const removed = await repo.delete(saved.id);
    expect(removed).toBe(true);
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.findById(saved.id)).toBeNull();
  });

  it("존재하지 않는 물고기 삭제는 false 를 반환하고 상태를 바꾸지 않는다", async () => {
    const repo = new InMemoryFishRepository();
    await repo.create(sampleRecord());
    const removed = await repo.delete("missing");
    expect(removed).toBe(false);
    expect(await repo.list()).toHaveLength(1);
  });

  it("특정 물고기만 삭제하고 나머지는 유지한다", async () => {
    const repo = new InMemoryFishRepository();
    const a = await repo.create(sampleRecord({ ownerId: "a" }));
    const b = await repo.create(sampleRecord({ ownerId: "b" }));
    await repo.delete(a.id);
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(b.id);
  });
});
