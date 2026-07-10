import { describe, it, expect } from "vitest";
import { toPublicMyTankFish, toPublicMyTankDecor } from "./publicMyTank.js";

// 내 어항 공개 투영 — 내부 ownerId 비노출 경계 검증.
// 모든 읽기 응답은 이 투영을 통과해야 하며 owner_id 는 절대 포함되지 않는다.

describe("toPublicMyTankFish", () => {
  const stored = {
    id: "fish-1",
    ownerId: "owner-secret-123",
    drawing: { version: 1, width: 300, height: 200, strokes: [] },
    displayMode: "named",
    displayName: "내물고기",
    x: 120.5,
    y: 42,
    scale: 1.5,
    createdAt: "2026-07-10T00:00:00.000Z",
  };

  it("ownerId 를 제거하고 공개 필드(scale 포함)만 투영한다", () => {
    const pub = toPublicMyTankFish(stored);
    expect(pub).toEqual({
      id: "fish-1",
      drawing: stored.drawing,
      displayMode: "named",
      displayName: "내물고기",
      x: 120.5,
      y: 42,
      scale: 1.5,
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    expect("ownerId" in pub).toBe(false);
  });

  it("익명 물고기는 displayName 을 null 로 투영한다", () => {
    const pub = toPublicMyTankFish({
      ...stored,
      displayMode: "anonymous",
      displayName: undefined,
    });
    expect(pub.displayMode).toBe("anonymous");
    expect(pub.displayName).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("owner-secret-123");
  });
});

describe("toPublicMyTankDecor", () => {
  const stored = {
    id: "decor-1",
    ownerId: "owner-secret-123",
    kind: "seaweed",
    x: 10,
    y: 20,
    scale: 0.75,
    createdAt: "2026-07-10T00:00:00.000Z",
  };

  it("ownerId 를 제거하고 공개 필드(scale 포함)만 투영한다", () => {
    const pub = toPublicMyTankDecor(stored);
    expect(pub).toEqual({
      id: "decor-1",
      kind: "seaweed",
      x: 10,
      y: 20,
      scale: 0.75,
      createdAt: "2026-07-10T00:00:00.000Z",
    });
    expect("ownerId" in pub).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("owner-secret-123");
  });
});
