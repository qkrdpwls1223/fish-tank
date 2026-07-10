// @MX:ANCHOR: [AUTO] 내 어항 공개 투영 — 소유자 신원 비노출 경계
// @MX:REASON: 개인 어항의 물고기/장식 읽기 응답은 모두 이 투영을 통과해야 하며,
//   내부 ownerId 는 소유권 검증 전용이라 어떤 응답에도 포함되면 안 된다. GET/POST/PATCH
//   응답이 함께 의존한다(fan_in >= 3 예상).

/**
 * 저장된 내 어항 물고기를 외부 공개 형식으로 투영한다.
 * ownerId 는 절대 포함하지 않는다(익명/이름 무관).
 * @param {{id,drawing,displayMode,displayName,x,y,scale,createdAt}} stored
 * @returns {{id,drawing,displayMode,displayName,x,y,scale,createdAt}}
 */
export function toPublicMyTankFish(stored) {
  return {
    id: stored.id,
    drawing: stored.drawing,
    displayMode: stored.displayMode,
    displayName: stored.displayName ?? null,
    x: stored.x,
    y: stored.y,
    scale: stored.scale,
    createdAt: stored.createdAt,
  };
}

/**
 * 저장된 내 어항 장식을 외부 공개 형식으로 투영한다.
 * ownerId 는 절대 포함하지 않는다.
 * @param {{id,kind,x,y,scale,createdAt}} stored
 * @returns {{id,kind,x,y,scale,createdAt}}
 */
export function toPublicMyTankDecor(stored) {
  return {
    id: stored.id,
    kind: stored.kind,
    x: stored.x,
    y: stored.y,
    scale: stored.scale,
    createdAt: stored.createdAt,
  };
}
