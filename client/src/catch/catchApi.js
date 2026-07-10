// 낚시(catch) API 클라이언트. 검증된 Teams SSO 토큰을 Bearer 로 전달한다(NFR-SEC-001).
// fishApi.js 규약을 그대로 따른다: 객체 인자 + 주입 가능한 fetchImpl, error.code 전달.

/**
 * 공유 어항의 물고기를 낚아 개인 수집함에 스냅샷을 추가한다 (REQ-CATCH-001).
 * 서버는 원본 물고기 ID만 받아 스냅샷을 서버 저장 데이터에서 유도하므로 본문을 보내지 않는다
 * (NFR-SEC-002 — 클라이언트 콘텐츠 주입 방지). 신규는 201, 중복(멱등)은 200으로 온다(REQ-CATCH-005).
 * @param {{token:string, id:string}} params - id 는 낚을 원본 물고기 ID
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 낚은 스냅샷. alreadyCollected(중복 여부) 포함.
 * @throws {Error & {code?:string}} 없는 물고기(404, code="not_found")/미인증(401) 등 실패 시
 */
export async function catchFish({ token, id }, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/fish/${id}/catch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("물고기를 낚지 못했습니다.");
    err.code = body?.error?.code;
    throw err;
  }

  return res.json();
}

/**
 * 본인이 낚은 물고기 목록을 조회한다 (REQ-COLL-001). 서버가 인증 신원으로 스코프하고
 * 최신순으로 정렬해 응답하며, owner_id 는 응답에 포함되지 않는다(REQ-PRIV-003, REQ-PRIV-004).
 * @param {{token:string}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>} 낚은 스냅샷 배열(최신순). 없으면 빈 배열.
 * @throws {Error & {code?:string}} 미인증(401) 등 실패 시
 */
export async function fetchCatches({ token }, fetchImpl = fetch) {
  const res = await fetchImpl("/api/me/catches", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("수집함을 불러오지 못했습니다.");
    err.code = body?.error?.code;
    throw err;
  }

  return res.json();
}
