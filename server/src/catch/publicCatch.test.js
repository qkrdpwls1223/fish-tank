import { describe, it, expect } from "vitest";
import { toPublicCatch } from "./publicCatch.js";

// 수집 공개 투영 — 원본 소유자 신원(owner_id) 비노출 경계 검증.
// 커버: REQ-PRIV-004, REQ-COLL-003(스냅샷 렌더링), REQ-COLL-004(caught_at 메타).

// 내부 수집 레코드(저장소 반환 형식).
function storedCatch(overrides = {}) {
  return {
    id: "aaaaaaaa",
    catcherId: "catcher-1",
    sourceFishId: "11111111",
    drawing: { version: 1, width: 300, height: 200, strokes: [] },
    displayMode: "named",
    displayName: "홍길동",
    caughtAt: "2026-07-10T00:00:00.000Z",
    // 만약 저장소가 실수로 ownerId 를 흘려도 투영이 제거해야 한다.
    ownerId: "secret-owner-999",
    ...overrides,
  };
}

describe("toPublicCatch", () => {
  it("스냅샷 필드(drawing/displayMode/displayName)와 caughtAt 을 포함한다 (REQ-COLL-003/004)", () => {
    const view = toPublicCatch(storedCatch());
    expect(view.id).toBe("aaaaaaaa");
    expect(view.drawing).toEqual(storedCatch().drawing);
    expect(view.displayMode).toBe("named");
    expect(view.displayName).toBe("홍길동");
    expect(view.caughtAt).toBe("2026-07-10T00:00:00.000Z");
  });

  it("원본 소유자 신원(ownerId)을 절대 노출하지 않는다 (REQ-PRIV-004)", () => {
    const view = toPublicCatch(storedCatch());
    expect("ownerId" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("secret-owner-999");
  });

  it("익명 스냅샷은 displayName 을 null 로 투영한다 (REQ-PRIV-004)", () => {
    const view = toPublicCatch(
      storedCatch({ displayMode: "anonymous", displayName: null }),
    );
    expect(view.displayMode).toBe("anonymous");
    expect(view.displayName).toBeNull();
  });
});
