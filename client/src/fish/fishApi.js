// 물고기 생성 API 클라이언트. 검증된 Teams SSO 토큰을 Bearer 로 전달한다(NFR-SEC-001).
// fetchImpl 을 주입 가능하게 해 테스트에서 네트워크 없이 검증한다.

/**
 * 물고기를 서버에 생성 요청한다.
 * @param {{token:string, drawing:object, displayMode:'named'|'anonymous'}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 서버가 반환한 공개 물고기(소유자 신원 미포함)
 * @throws {Error & {code?:string, reason?:string}}
 */
export async function submitFish(
  { token, drawing, displayMode },
  fetchImpl = fetch,
) {
  const res = await fetchImpl("/api/fish", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ drawing, displayMode }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("물고기 생성에 실패했습니다.");
    err.code = body?.error?.code;
    err.reason = body?.error?.reason;
    throw err;
  }

  return res.json();
}

/**
 * 어항 진입/재연결 시 전체 물고기 스냅샷을 로드한다 (REQ-RT-004, REQ-RT-003).
 * 서버는 공개 형식(ownerId 미포함)으로만 응답한다(REQ-OWN-004).
 * @param {{token:string}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>}
 */
export async function fetchFishSnapshot({ token }, fetchImpl = fetch) {
  const res = await fetchImpl("/api/fish", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("어항 상태를 불러오지 못했습니다.");
    err.code = body?.error?.code;
    throw err;
  }

  return res.json();
}

/**
 * 본인이 만든 물고기를 삭제한다 (REQ-OWN-002). 소유권은 서버가 토큰 신원으로 검증한다(NFR-SEC-002).
 * 성공 시 실제 어항 제거는 실시간 fish_deleted 이벤트가 담당한다(REQ-RT-002).
 * @param {{token:string, id:string}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<void>}
 * @throws {Error & {code?:string}} 권한 없음(403)/없음(404) 등 실패 시
 */
export async function deleteFish({ token, id }, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/fish/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("물고기 삭제에 실패했습니다.");
    err.code = body?.error?.code;
    throw err;
  }
}
