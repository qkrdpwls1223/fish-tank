# API 레퍼런스 (공유 어항 서버)

SPEC: `.moai/specs/SPEC-TANK-001/spec.md`

이 문서는 `server/src/app.js` 에 실제로 구현된 REST 엔드포인트와, `server/src/server.js` 가 여는
WebSocket(`/realtime`) 이벤트 스키마를 그대로 기술합니다. 모든 예시는 코드 기준이며, 명세에는
있으나 아직 구현되지 않은 항목은 없습니다.

## 인증 (모든 `/api/*` 공통)

- `GET /healthz` 를 제외한 모든 `/api/*` 라우트는 `authRequired` 미들웨어(`server/src/auth/authMiddleware.js`)를 통과해야 합니다.
- 요청 헤더: `Authorization: Bearer <Teams SSO JWT>`
- 서버는 `jose` 로 JWT를 검증하고(`server/src/auth/verifyTeamsToken.js`), `audience`/`issuer`/서명을 확인합니다. 클라이언트가 보낸 사용자 ID/이름은 **절대 신뢰하지 않습니다** (NFR-SEC-001, NFR-SEC-002).
- 검증 성공 시 `req.user = { userId, displayName, tenantId }` 가 설정되고, 이 값만 이후 모든 쓰기 작업의 소유자 근거로 사용됩니다.
- 인증 실패 시 공통 오류 응답:

  | 상황 | HTTP | `error.code` |
  |---|---|---|
  | `Authorization` 헤더 없음/형식 오류 | 401 | `unauthorized` (reason: `missing_token`) |
  | 토큰 만료 | 401 | `expired` |
  | audience 불일치 | 401 | `invalid_audience` |
  | issuer 불일치 | 401 | `invalid_issuer` |
  | 서명/JWKS 매칭 실패 | 401 | `invalid_signature` |
  | 형식 오류/파싱 실패 | 401 | `malformed` |
  | 필수 클레임(`oid`) 없음 | 401 | `missing_claim` |

## `GET /healthz`

인증 불필요. 헬스체크 전용.

응답 `200`:
```json
{ "status": "ok" }
```

## `GET /api/me`

검증된 사용자 신원을 그대로 반환합니다(REQ-AUTH-002 종단 증명용).

응답 `200`:
```json
{ "userId": "<oid claim>", "displayName": "<name claim>", "tenantId": "<tid claim>" }
```

## `GET /api/fish`

어항 진입/재연결 시 전체 물고기 스냅샷을 로드합니다(REQ-RT-004, REQ-RT-003). 요청자 기준으로
투영되어 `deletable` 플래그가 함께 내려갑니다. **내부 `ownerId`는 응답에 절대 포함되지 않습니다** (REQ-OWN-004).

응답 `200` — 배열, 각 원소:
```json
{
  "id": "uuid",
  "drawing": { "version": 1, "width": 320, "height": 240, "strokes": [ { "color": "#1d4ed8", "width": 4, "points": [{ "x": 10, "y": 12 }] } ] },
  "displayMode": "named",
  "displayName": "홍길동",
  "createdAt": "2026-07-08T00:00:00.000Z",
  "deletable": true
}
```

- `displayMode: "anonymous"` 인 경우 `displayName` 은 항상 `null` 입니다.
- `deletable` 은 `stored.ownerId === req.user.userId` 일 때만 `true` 입니다(REQ-OWN-002). 소유자가 아니면(타인의 물고기) `false` 이며, 어떤 경우에도 실제 소유자 ID는 노출되지 않습니다.

## `POST /api/fish`

물고기를 새로 등록합니다(REQ-DRAW-001~003, REQ-AUTH-003).

요청 본문:
```json
{
  "drawing": { "version": 1, "width": 320, "height": 240, "strokes": [ { "color": "#1d4ed8", "width": 4, "points": [{ "x": 10, "y": 12 }, { "x": 20, "y": 30 }] } ] },
  "displayMode": "named"
}
```

- `displayMode` 는 `"named"` 또는 `"anonymous"` 만 허용됩니다.
- `drawing` 은 서버에서 독립 검증됩니다(클라이언트 검증과 별개, NFR-SEC-003). 검증 규칙(`server/src/fish/validateDrawing.js` `DRAWING_LIMITS`):
  - 최상위 구조: `version === 1`, `width`/`height` 는 1~2000px 정수, `strokes` 배열(최대 500개)
  - 각 스트로크: `color` 는 `#rrggbb` 헥스만 허용(스크립트/URL 주입 차단), `width` 는 1~50, `points` 는 스트로크당 최대 5000개, 좌표는 캔버스 경계(`0 <= x <= width`, `0 <= y <= height`) 내
  - 빈/무효 그림 거부: 총 포인트 수 2개 미만이면 `empty` (REQ-DRAW-004)
  - 최소 크기: 바운딩 박스(너비+높이)가 8px 미만이면 `too_small`
  - 크기 상한: 직렬화된 JSON 문자열이 100KB 초과 시 `too_large`
- 소유자(`ownerId`)와 표시 이름은 **오직 검증된 토큰에서만 유도**됩니다. 익명이어도 내부 `ownerId` 는 항상 저장됩니다(REQ-OWN-001). `displayMode: "anonymous"` 이면 `displayName` 은 저장 시 `null` 로 고정됩니다.

응답 `201` — 생성자 본인 관점의 뷰어 투영(`deletable: true` 포함):
```json
{
  "id": "uuid",
  "drawing": { "...": "..." },
  "displayMode": "named",
  "displayName": "홍길동",
  "createdAt": "2026-07-08T00:00:00.000Z",
  "deletable": true
}
```

오류:

| 상황 | HTTP | `error.code` | `error.reason` |
|---|---|---|---|
| `displayMode` 이 `named`/`anonymous` 가 아님 | 400 | `invalid_display_mode` | — |
| 그림 데이터 검증 실패 | 400 | `invalid_drawing` | `invalid_format` \| `empty` \| `too_small` \| `too_large` |

성공 시 부수 효과: 저장된 물고기를 **공개 투영**(`toPublicFish`, `ownerId` 미포함)으로 변환해 WebSocket `fish_added` 이벤트로 접속 중인 모든 클라이언트에 브로드캐스트합니다(REQ-RT-001).

## `DELETE /api/fish/:id`

본인이 생성한 물고기를 삭제합니다(REQ-OWN-002). 이름 물고기와 익명 물고기를 구분하지 않습니다.

- 소유권 검증은 **서버가 유일한 권위**를 가집니다: 저장된 내부 `ownerId` 와 검증된 토큰의 `req.user.userId` 만 비교합니다. 클라이언트가 보낸 어떤 소유자 정보도 무시합니다(NFR-SEC-002).

응답:

| 상황 | HTTP | `error.code` |
|---|---|---|
| 삭제 성공 | 204 | — (본문 없음) |
| 대상 없음 | 404 | `not_found` |
| 타인 소유(권한 없음) | 403 | `forbidden` |

- 404/403 응답 모두 실제 소유자 신원을 노출하지 않습니다(REQ-OWN-004).
- 성공 시 부수 효과: `{ type: "fish_deleted", id }` 를 브로드캐스트해 접속 중인 모든 클라이언트 어항에서 실시간 제거합니다(REQ-RT-002).

## `POST /api/feed`

먹이주기 이벤트를 접속 중인 사용자에게 실시간으로 공유합니다(REQ-INT-001, REQ-INT-003). **먹이는 저장되지 않는 임시 효과**이며 영속성/소유권 레코드가 없습니다.

요청 본문:
```json
{ "x": 120.5, "y": 88.0 }
```

- `x`, `y` 는 유한한 숫자만 허용됩니다(비숫자/`NaN`/`Infinity` 거부).

응답:

| 상황 | HTTP | `error.code` |
|---|---|---|
| 성공 | 200 | — (`{ "ok": true }`) |
| 좌표 형식 오류 | 400 | `invalid_food` |

부수 효과: `{ type: "food_dropped", food: { x, y } }` 를 브로드캐스트합니다. 이벤트에는 **호출자의 신원이 절대 포함되지 않습니다**(REQ-OWN-004).

---

## WebSocket 실시간 채널 — `/realtime`

- URL: 클라이언트는 `client/src/tank/realtimeClient.js` 의 `defaultRealtimeUrl()` 로 현재 페이지 기준 `ws(s)://<host>/realtime` 를 유도합니다(별도 env 불필요, 리버스 프록시로 `/realtime` 전달 시 그대로 동작).
- 인증: 현재 WebSocket 연결 자체에는 별도 인증 핸드셰이크가 없습니다. 모든 신원 검증은 REST 쓰기 경로(`POST /api/fish`, `DELETE /api/fish/:id`, `POST /api/feed`)에서 이루어지며, WS는 서버에서 이미 검증·투영된 이벤트를 그대로 팬아웃합니다.
- 흐름: 클라이언트는 진입/재연결 시 `GET /api/fish` 로 스냅샷을 로드한 뒤, WS로 델타(추가/삭제/먹이)를 수신합니다(REQ-RT-004 → REQ-RT-001/002).
- 재연결: 연결이 끊기면 `client/src/tank/realtimeClient.js` 가 자동 재연결을 예약하고, 재연결(`onOpen`) 시 호출부가 스냅샷을 다시 로드해 재동기화합니다(REQ-RT-003). 서버 측에는 별도 재전송 버퍼가 없으므로, 끊긴 동안의 델타는 재연결 후 스냅샷 재조회로 보정됩니다.

### 이벤트 형식

모든 이벤트는 JSON 문자열로 전송되며 `type` 필드로 구분됩니다. **어떤 이벤트도 소유자 신원(`ownerId`)을 포함하지 않습니다** (REQ-OWN-004).

#### `fish_added`

```json
{ "type": "fish_added", "fish": { "id": "uuid", "drawing": { "...": "..." }, "displayMode": "named", "displayName": "홍길동", "createdAt": "2026-07-08T00:00:00.000Z" } }
```

- `fish` 는 공개 투영(`toPublicFish`) 결과입니다. `deletable` 플래그는 포함되지 않습니다(그 값은 요청자마다 달라야 하므로 REST 스냅샷 응답에만 존재).

#### `fish_deleted`

```json
{ "type": "fish_deleted", "id": "uuid" }
```

#### `food_dropped`

```json
{ "type": "food_dropped", "food": { "x": 120.5, "y": 88.0 } }
```

---

## 참고

- 서버 측 라우트 구현: `server/src/routes/fish.js`, `server/src/routes/me.js`, `server/src/app.js`
- 그림 검증 규칙: `server/src/fish/validateDrawing.js`
- 공개 투영 규칙: `server/src/fish/publicFish.js`
- 실시간 게이트웨이: `server/src/realtime/broadcaster.js`, `server/src/realtime/wsGateway.js`, `server/src/server.js`
