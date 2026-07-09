// @MX:ANCHOR: [AUTO] 물고기 공개 투영 — 소유자 신원 비노출 경계
// @MX:REASON: REQ-OWN-004. 내부 ownerId 는 삭제 권한 검증 전용이며 어떤 읽기 응답에도
//   포함되면 안 된다. 모든 물고기 읽기 경로가 이 투영을 통과해야 한다(fan_in >= 3 예상).

/**
 * 저장 레코드를 외부 공개 형식으로 투영한다.
 * ownerId 는 절대 포함하지 않는다(익명/이름 무관).
 * @param {{id,drawing,displayMode,displayName,createdAt}} stored
 * @returns {{id,drawing,displayMode,displayName,createdAt}}
 */
export function toPublicFish(stored) {
  return {
    id: stored.id,
    drawing: stored.drawing,
    displayMode: stored.displayMode,
    displayName: stored.displayName ?? null,
    createdAt: stored.createdAt,
  };
}

// @MX:NOTE: [AUTO] 뷰어 인지 투영 — toPublicFish 위에 요청 사용자 기준 deletable 만 얹는다.
//   ownerId 는 절대 응답에 포함하지 않고(REQ-OWN-004), 소유 여부(불리언)만 계산해
//   클라이언트가 내부 소유자 ID 없이 삭제 UI 를 노출할 수 있게 한다(REQ-OWN-002).
/**
 * 요청 사용자 기준 공개 투영. deletable = (내부 ownerId === 요청 사용자 id).
 * ownerId 는 결과에 포함하지 않는다.
 * @param {{id,drawing,displayMode,displayName,createdAt,ownerId}} stored
 * @param {string|undefined} viewerUserId - 인증된 요청 사용자 id
 * @returns {{id,drawing,displayMode,displayName,createdAt,deletable:boolean}}
 */
export function toViewerFish(stored, viewerUserId) {
  return {
    ...toPublicFish(stored),
    deletable: Boolean(viewerUserId) && stored.ownerId === viewerUserId,
  };
}
