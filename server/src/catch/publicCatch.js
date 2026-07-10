// @MX:ANCHOR: [AUTO] 수집 공개 투영 — 원본 소유자 신원 비노출 경계
// @MX:REASON: REQ-PRIV-004(REQ-OWN-004 확장). 낚시/수집함의 모든 읽기 응답은 이 투영을
//   통과해야 하며, 원본 물고기의 내부 ownerId 를 절대 포함해서는 안 된다(낚기 응답 + 수집함 목록, fan_in >= 3 예상).

/**
 * 저장된 수집 스냅샷을 외부 공개 형식으로 투영한다.
 * 낚은 시점 스냅샷(drawing/displayMode/displayName)과 수집 메타(sourceFishId/caughtAt)만 담고,
 * 원본 소유자 신원(ownerId 등)은 어떤 경우에도 포함하지 않는다(REQ-PRIV-004).
 * catcherId 는 조회자 본인이므로 응답에 담지 않는다(불필요·최소 노출).
 * @param {{id,catcherId,sourceFishId,drawing,displayMode,displayName,caughtAt}} stored
 * @returns {{id,sourceFishId,drawing,displayMode,displayName,caughtAt}}
 */
export function toPublicCatch(stored) {
  return {
    id: stored.id,
    sourceFishId: stored.sourceFishId,
    drawing: stored.drawing,
    displayMode: stored.displayMode,
    displayName: stored.displayName ?? null,
    caughtAt: stored.caughtAt,
  };
}
