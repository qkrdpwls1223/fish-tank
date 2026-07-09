import { describe, it, expect } from "vitest";
import { toPublicFish, toViewerFish } from "./publicFish.js";

// 읽기 응답 투영(projection): 내부 소유자 신원을 절대 노출하지 않는다 (REQ-OWN-004).

const storedNamed = {
  id: "fish-1",
  drawing: { version: 1, width: 300, height: 200, strokes: [] },
  ownerId: "owner-secret-123",
  displayMode: "named",
  displayName: "홍길동",
  createdAt: "2026-07-09T00:00:00.000Z",
};

const storedAnon = {
  ...storedNamed,
  id: "fish-2",
  displayMode: "anonymous",
  displayName: null,
};

describe("toPublicFish", () => {
  it("이름 물고기의 공개 필드만 반환한다(ownerId 제외)", () => {
    const pub = toPublicFish(storedNamed);
    expect(pub).toEqual({
      id: "fish-1",
      drawing: storedNamed.drawing,
      displayMode: "named",
      displayName: "홍길동",
      createdAt: "2026-07-09T00:00:00.000Z",
    });
  });

  it("어떤 경우에도 ownerId 키를 포함하지 않는다 (REQ-OWN-004)", () => {
    expect("ownerId" in toPublicFish(storedNamed)).toBe(false);
    expect("ownerId" in toPublicFish(storedAnon)).toBe(false);
  });

  it("익명 물고기는 displayName 을 노출하지 않는다(null)", () => {
    const pub = toPublicFish(storedAnon);
    expect(pub.displayMode).toBe("anonymous");
    expect(pub.displayName).toBeNull();
    expect(Object.values(pub)).not.toContain("owner-secret-123");
  });
});

// M4: 뷰어(요청 사용자) 기준 투영. ownerId 를 노출하지 않으면서
// 요청 사용자가 삭제 가능한지(deletable) 만 계산해 알려준다 (REQ-OWN-002/004).
describe("toViewerFish", () => {
  it("요청 사용자가 소유자면 deletable:true 를 붙인다(ownerId 는 미노출)", () => {
    const view = toViewerFish(storedNamed, "owner-secret-123");
    expect(view.deletable).toBe(true);
    expect("ownerId" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("owner-secret-123");
  });

  it("요청 사용자가 소유자가 아니면 deletable:false 를 붙인다", () => {
    const view = toViewerFish(storedNamed, "someone-else");
    expect(view.deletable).toBe(false);
    expect("ownerId" in view).toBe(false);
  });

  it("익명 물고기도 소유자 본인에게는 deletable:true (신원은 미노출, REQ-OWN-001/004)", () => {
    const view = toViewerFish(storedAnon, "owner-secret-123");
    expect(view.deletable).toBe(true);
    expect(view.displayMode).toBe("anonymous");
    expect(view.displayName).toBeNull();
    expect(JSON.stringify(view)).not.toContain("owner-secret-123");
  });

  it("익명 물고기는 타인에게 deletable:false 이며 신원이 노출되지 않는다 (REQ-OWN-003/004)", () => {
    const view = toViewerFish(storedAnon, "attacker");
    expect(view.deletable).toBe(false);
    expect(JSON.stringify(view)).not.toContain("owner-secret-123");
  });

  it("뷰어 id 가 없으면(미인증 가정) deletable:false 이다", () => {
    const view = toViewerFish(storedNamed, undefined);
    expect(view.deletable).toBe(false);
  });

  it("toPublicFish 의 모든 공개 필드를 그대로 포함한다", () => {
    const view = toViewerFish(storedNamed, "owner-secret-123");
    const pub = toPublicFish(storedNamed);
    for (const key of Object.keys(pub)) {
      expect(view[key]).toEqual(pub[key]);
    }
  });
});
