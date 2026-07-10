import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMyTankRepository } from "./myTankRepository.js";

// 내 어항 인메모리 저장소 계약 검증.
// 핵심 불변식: 모든 읽기/변경/삭제는 ownerId 로 스코프되며, 타인 행은 절대 건드릴 수 없다.

function drawing() {
  return { version: 1, width: 300, height: 200, strokes: [] };
}

describe("InMemoryMyTankRepository — fish", () => {
  let repo;
  beforeEach(() => {
    repo = new InMemoryMyTankRepository();
  });

  it("createFish 는 id/createdAt 을 부여하고 소유자·좌표를 저장한다", async () => {
    const saved = await repo.createFish({
      ownerId: "A",
      drawing: drawing(),
      displayMode: "named",
      displayName: "물고기A",
      x: 12,
      y: 34,
    });
    expect(saved.id).toBeTypeOf("string");
    expect(saved.ownerId).toBe("A");
    expect(saved.displayMode).toBe("named");
    expect(saved.displayName).toBe("물고기A");
    expect(saved.x).toBe(12);
    expect(saved.y).toBe(34);
    expect(saved.createdAt).toBeTypeOf("string");
  });

  it("listFishByOwner 는 본인 소유 물고기만 반환한다 (스코프)", async () => {
    await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 2, y: 2 });
    await repo.createFish({ ownerId: "B", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 3, y: 3 });

    const mine = await repo.listFishByOwner("A");
    expect(mine).toHaveLength(2);
    expect(mine.every((f) => f.ownerId === "A")).toBe(true);
    expect(await repo.listFishByOwner("B")).toHaveLength(1);
    expect(await repo.listFishByOwner("C")).toEqual([]);
  });

  it("updateFishPosition 는 본인 소유 물고기의 좌표를 갱신하고 갱신본을 반환한다", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    const updated = await repo.updateFishPosition({ id: f.id, ownerId: "A", x: 99, y: 88 });
    expect(updated.x).toBe(99);
    expect(updated.y).toBe(88);
    const mine = await repo.listFishByOwner("A");
    expect(mine[0].x).toBe(99);
  });

  it("updateFishPosition 는 타인 소유 물고기를 갱신하지 않고 null 을 반환한다 (스코프)", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    const res = await repo.updateFishPosition({ id: f.id, ownerId: "B", x: 99, y: 88 });
    expect(res).toBeNull();
    // 원본은 변경되지 않았다.
    const mine = await repo.listFishByOwner("A");
    expect(mine[0].x).toBe(1);
    expect(mine[0].y).toBe(1);
  });

  it("updateFishPosition 는 존재하지 않는 물고기에 대해 null 을 반환한다", async () => {
    expect(await repo.updateFishPosition({ id: "nope", ownerId: "A", x: 1, y: 1 })).toBeNull();
  });

  it("deleteFish 는 본인 소유 물고기를 삭제하고 true 를 반환한다", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    expect(await repo.deleteFish({ id: f.id, ownerId: "A" })).toBe(true);
    expect(await repo.listFishByOwner("A")).toHaveLength(0);
  });

  it("deleteFish 는 타인 소유 물고기를 삭제하지 않고 false 를 반환한다 (스코프)", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    expect(await repo.deleteFish({ id: f.id, ownerId: "B" })).toBe(false);
    // 원본 생존.
    expect(await repo.listFishByOwner("A")).toHaveLength(1);
  });

  it("반환값은 방어적 복사본이라 외부 변형이 저장소에 영향을 주지 않는다", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    f.x = 777;
    const mine = await repo.listFishByOwner("A");
    expect(mine[0].x).toBe(1);
  });

  it("createFish 는 전달된 scale 을 저장하고 반환한다", async () => {
    const saved = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1, scale: 2.5 });
    expect(saved.scale).toBe(2.5);
    const mine = await repo.listFishByOwner("A");
    expect(mine[0].scale).toBe(2.5);
  });

  it("createFish 는 scale 이 없으면 기본값 1.0 을 사용한다", async () => {
    const saved = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    expect(saved.scale).toBe(1.0);
  });

  it("updateFishPosition 는 scale 이 주어지면 좌표와 함께 갱신한다", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1 });
    const updated = await repo.updateFishPosition({ id: f.id, ownerId: "A", x: 9, y: 8, scale: 1.5 });
    expect(updated.x).toBe(9);
    expect(updated.y).toBe(8);
    expect(updated.scale).toBe(1.5);
    const mine = await repo.listFishByOwner("A");
    expect(mine[0].scale).toBe(1.5);
  });

  it("updateFishPosition 는 scale 이 없으면 기존 scale 을 유지한다", async () => {
    const f = await repo.createFish({ ownerId: "A", drawing: drawing(), displayMode: "anonymous", displayName: null, x: 1, y: 1, scale: 2.0 });
    const updated = await repo.updateFishPosition({ id: f.id, ownerId: "A", x: 9, y: 8 });
    expect(updated.scale).toBe(2.0);
  });
});

describe("InMemoryMyTankRepository — decor", () => {
  let repo;
  beforeEach(() => {
    repo = new InMemoryMyTankRepository();
  });

  it("createDecor 는 id/createdAt 을 부여하고 소유자·종류·좌표를 저장한다", async () => {
    const saved = await repo.createDecor({ ownerId: "A", kind: "rock", x: 5, y: 6 });
    expect(saved.id).toBeTypeOf("string");
    expect(saved.ownerId).toBe("A");
    expect(saved.kind).toBe("rock");
    expect(saved.x).toBe(5);
    expect(saved.y).toBe(6);
    expect(saved.createdAt).toBeTypeOf("string");
  });

  it("listDecorByOwner 는 본인 소유 장식만 반환한다 (스코프)", async () => {
    await repo.createDecor({ ownerId: "A", kind: "rock", x: 1, y: 1 });
    await repo.createDecor({ ownerId: "B", kind: "castle", x: 2, y: 2 });
    const mine = await repo.listDecorByOwner("A");
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("rock");
    expect(await repo.listDecorByOwner("B")).toHaveLength(1);
  });

  it("updateDecorPosition 는 본인 소유 장식을 갱신하고 타인 것은 null 을 반환한다", async () => {
    const d = await repo.createDecor({ ownerId: "A", kind: "seaweed", x: 1, y: 1 });
    const updated = await repo.updateDecorPosition({ id: d.id, ownerId: "A", x: 50, y: 60 });
    expect(updated.x).toBe(50);
    expect(updated.y).toBe(60);
    expect(await repo.updateDecorPosition({ id: d.id, ownerId: "B", x: 0, y: 0 })).toBeNull();
    const mine = await repo.listDecorByOwner("A");
    expect(mine[0].x).toBe(50);
  });

  it("deleteDecor 는 본인 소유만 삭제하고 타인 것은 false 를 반환한다 (스코프)", async () => {
    const d = await repo.createDecor({ ownerId: "A", kind: "seaweed", x: 1, y: 1 });
    expect(await repo.deleteDecor({ id: d.id, ownerId: "B" })).toBe(false);
    expect(await repo.listDecorByOwner("A")).toHaveLength(1);
    expect(await repo.deleteDecor({ id: d.id, ownerId: "A" })).toBe(true);
    expect(await repo.listDecorByOwner("A")).toHaveLength(0);
  });

  it("createDecor 는 전달된 scale 을 저장하고, 없으면 기본값 1.0 을 사용한다", async () => {
    const withScale = await repo.createDecor({ ownerId: "A", kind: "rock", x: 1, y: 1, scale: 0.5 });
    expect(withScale.scale).toBe(0.5);
    const defaulted = await repo.createDecor({ ownerId: "A", kind: "rock", x: 2, y: 2 });
    expect(defaulted.scale).toBe(1.0);
    const mine = await repo.listDecorByOwner("A");
    expect(mine.map((d) => d.scale).sort()).toEqual([0.5, 1.0]);
  });

  it("updateDecorPosition 는 scale 이 주어지면 함께 갱신하고, 없으면 기존 scale 을 유지한다", async () => {
    const d = await repo.createDecor({ ownerId: "A", kind: "seaweed", x: 1, y: 1, scale: 2.0 });
    const updated = await repo.updateDecorPosition({ id: d.id, ownerId: "A", x: 5, y: 6, scale: 1.25 });
    expect(updated.scale).toBe(1.25);
    const kept = await repo.updateDecorPosition({ id: d.id, ownerId: "A", x: 7, y: 8 });
    expect(kept.scale).toBe(1.25);
  });
});
