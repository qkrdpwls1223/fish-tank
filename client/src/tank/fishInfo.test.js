import { describe, it, expect } from "vitest";
import { fishInfo, ANONYMOUS_LABEL } from "./fishInfo.js";

// 물고기 정보 표시 로직(순수 함수) 단위 테스트 (REQ-INT-002).
// 공개 물고기 → 표시 정보 매핑. 익명은 "익명"으로만 노출하고 소유자 신원은 절대 담지 않는다.

describe("fishInfo", () => {
  it("이름 물고기는 표시 이름과 생성 시각을 노출한다 (REQ-INT-002)", () => {
    const info = fishInfo({
      id: "a",
      displayMode: "named",
      displayName: "구피",
      createdAt: "2026-07-09T00:00:00.000Z",
    });
    expect(info.label).toBe("구피");
    expect(info.isAnonymous).toBe(false);
    expect(info.createdAt).toBe("2026-07-09T00:00:00.000Z");
  });

  it("익명 물고기는 '익명' 라벨로 표시한다 (REQ-OWN-004)", () => {
    const info = fishInfo({
      id: "x",
      displayMode: "anonymous",
      displayName: null,
      createdAt: "2026-07-09T01:00:00.000Z",
    });
    expect(info.label).toBe(ANONYMOUS_LABEL);
    expect(info.label).toBe("익명");
    expect(info.isAnonymous).toBe(true);
  });

  it("표시 이름이 없는 이름 물고기도 '익명'으로 안전하게 처리한다", () => {
    const info = fishInfo({
      id: "b",
      displayMode: "named",
      displayName: null,
      createdAt: "2026-07-09T00:00:00.000Z",
    });
    expect(info.label).toBe("익명");
    expect(info.isAnonymous).toBe(true);
  });

  it("익명 물고기 정보는 소유자 신원(ownerId 등)을 절대 포함하지 않는다 (REQ-OWN-004)", () => {
    // 방어적: 상위에서 실수로 ownerId 가 섞여 들어와도 출력에 새어나가면 안 된다.
    const info = fishInfo({
      id: "x",
      displayMode: "anonymous",
      displayName: null,
      createdAt: "2026-07-09T00:00:00.000Z",
      ownerId: "user-secret-42",
      displayNameSecret: "진짜이름",
    });
    expect("ownerId" in info).toBe(false);
    expect(JSON.stringify(info)).not.toContain("user-secret-42");
    expect(JSON.stringify(info)).not.toContain("진짜이름");
    expect(info.label).toBe("익명");
  });
});
