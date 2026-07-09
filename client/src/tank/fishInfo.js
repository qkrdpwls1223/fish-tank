// 물고기 정보 표시 로직(순수 함수). 공개 물고기 → 화면 표시 정보로 매핑한다 (REQ-INT-002).
// 익명 물고기는 "익명"으로만 노출하며 소유자 신원(ownerId 등)은 절대 담지 않는다(REQ-OWN-004).

// @MX:NOTE: [AUTO] 익명 물고기 표시 라벨. 소유자 실제 이름/ID 대신 항상 이 값을 노출한다.
export const ANONYMOUS_LABEL = "익명";

/**
 * 공개 물고기를 정보 표시용 형태로 투영한다.
 * 이름 물고기: 표시 이름 노출. 익명(또는 이름 누락): "익명"으로 노출.
 * 결과에는 오직 화면 노출 안전 필드만 담는다(ownerId 등 절대 미포함).
 * @param {{displayMode:string, displayName:string|null, createdAt:string}} fish
 * @returns {{label:string, isAnonymous:boolean, createdAt:string}}
 */
export function fishInfo(fish) {
  const named = fish.displayMode === "named" && Boolean(fish.displayName);
  return {
    label: named ? fish.displayName : ANONYMOUS_LABEL,
    isAnonymous: !named,
    createdAt: fish.createdAt,
  };
}
