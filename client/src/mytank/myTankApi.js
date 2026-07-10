// 내 어항(개인 전용) API 클라이언트. 모든 요청은 검증된 Bearer 토큰으로 호출자 스코프에
// 한정된다(호출자만 자기 어항을 읽고 쓴다). 서버 에러 형태는 { error: { code } }.
// fishApi.js 규약을 그대로 따른다: 객체 인자 { token, ... } + 주입 가능한 fetchImpl +
// 실패 시 error.code 추출. 테스트에서 네트워크 없이 요청 형태/헤더/에러를 검증한다.

// 공통 헤더: 인증 토큰을 Bearer 로 싣는다(호출자 신원은 서버가 토큰으로만 판별).
function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// 실패 응답을 code 를 담은 Error 로 변환한다(fishApi 와 동일 패턴).
async function toError(res, message) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(message);
  err.code = body?.error?.code;
  return err;
}

/**
 * 내 어항 전체(물고기 + 장식)를 로드한다. 호출자 본인 데이터만 응답된다.
 * @param {{token:string}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{fish:object[], decor:object[]}>}
 * @throws {Error & {code?:string}}
 */
export async function fetchMyTank({ token }, fetchImpl = fetch) {
  const res = await fetchImpl("/api/my-tank", {
    method: "GET",
    headers: authHeaders(token),
  });
  if (!res.ok) throw await toError(res, "내 어항을 불러오지 못했습니다.");
  return res.json();
}

/**
 * 내 어항에 물고기를 추가한다. 서버는 토큰에서 displayName 을 파생하므로
 * 클라이언트는 그림 + 표시모드 + 위치만 전송한다(400 invalid_drawing/invalid_position).
 * @param {{token:string, drawing:object, displayMode:'named'|'anonymous', x:number, y:number}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 생성된 물고기
 * @throws {Error & {code?:string}}
 */
export async function createMyTankFish(
  { token, drawing, displayMode, x, y },
  fetchImpl = fetch,
) {
  const res = await fetchImpl("/api/my-tank/fish", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ drawing, displayMode, x, y }),
  });
  if (!res.ok) throw await toError(res, "물고기를 넣지 못했습니다.");
  return res.json();
}

// x,y 는 필수, scale 은 선택. scale 이 주어졌을 때만 PATCH 본문에 싣는다(서버는 미포함 시
// 기존 크기를 유지, 포함 시 [0.3,3.0] 로 검증하고 벗어나면 400 invalid_scale).
function movePatchBody({ x, y, scale }) {
  const body = { x, y };
  if (scale !== undefined) body.scale = scale;
  return body;
}

/**
 * 내 어항 물고기 위치를 이동한다(드래그/키보드 이동 후 저장). scale 을 함께 주면 크기도 갱신한다.
 * 404 면 본인 것이 아니다.
 * @param {{token:string, id:string, x:number, y:number, scale?:number}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 갱신된 물고기
 * @throws {Error & {code?:string}}
 */
export async function moveMyTankFish({ token, id, x, y, scale }, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/my-tank/fish/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(movePatchBody({ x, y, scale })),
  });
  if (!res.ok) throw await toError(res, "물고기 위치를 옮기지 못했습니다.");
  return res.json();
}

/**
 * 내 어항 물고기를 삭제한다.
 * @param {{token:string, id:string}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<void>}
 * @throws {Error & {code?:string}}
 */
export async function deleteMyTankFish({ token, id }, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/my-tank/fish/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw await toError(res, "물고기를 삭제하지 못했습니다.");
}

/**
 * 내 어항에 장식을 추가한다. kind ∈ {seaweed, rock, castle} (400 invalid_kind).
 * @param {{token:string, kind:string, x:number, y:number}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 생성된 장식
 * @throws {Error & {code?:string}}
 */
export async function createMyTankDecor({ token, kind, x, y }, fetchImpl = fetch) {
  const res = await fetchImpl("/api/my-tank/decor", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ kind, x, y }),
  });
  if (!res.ok) throw await toError(res, "장식을 넣지 못했습니다.");
  return res.json();
}

/**
 * 내 어항 장식 위치를 이동한다. scale 을 함께 주면 크기도 갱신한다(선택, [0.3,3.0]).
 * @param {{token:string, id:string, x:number, y:number, scale?:number}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} 갱신된 장식
 * @throws {Error & {code?:string}}
 */
export async function moveMyTankDecor({ token, id, x, y, scale }, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/my-tank/decor/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(movePatchBody({ x, y, scale })),
  });
  if (!res.ok) throw await toError(res, "장식 위치를 옮기지 못했습니다.");
  return res.json();
}

/**
 * 내 어항 장식을 삭제한다.
 * @param {{token:string, id:string}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<void>}
 * @throws {Error & {code?:string}}
 */
export async function deleteMyTankDecor({ token, id }, fetchImpl = fetch) {
  const res = await fetchImpl(`/api/my-tank/decor/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw await toError(res, "장식을 삭제하지 못했습니다.");
}
