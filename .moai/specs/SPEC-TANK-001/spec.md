---
id: SPEC-TANK-001
version: 0.2.0
status: completed
created: 2026-07-08
updated: 2026-07-09
author: 예진
priority: high
issue_number: null
---

# SPEC-TANK-001: 공유 어항 (Microsoft Teams 탭 앱)

## HISTORY

- 2026-07-09 (v0.2.0): Run 단계 구현 완료 및 검증. M1~M6 전 마일스톤 완료, 테스트 242개 통과(client 128, server 114). 문서 동기화(sync) 진행 — status를 completed로 갱신하고 하단에 Implementation Notes 추가.
- 2026-07-08 (v0.1.0): 최초 작성. 그린필드 프로젝트. 확정된 요구사항(자유 드로잉, Teams SSO 인증, 실시간 반영, 영구 저장, 삭제 전용 관리, 먹이주기 상호작용)을 EARS 형식으로 정리. 익명 물고기 소유권/삭제 규칙을 명시적 요구사항으로 포함.

---

## Goal (목표)

회사 임직원이 **직접 손으로 그린 물고기**를 **공용 어항**에 풀어놓고, 다른 사람이 그린 물고기가 함께 헤엄치는 모습을 **실시간**으로 감상하고 상호작용(먹이주기 등)하는 사내 협업/휴식 경험을 제공한다. Microsoft Teams 내장 탭 앱으로 동작하며, 사내 임직원만 이용한다.

## Target Audience (대상 사용자)

- 회사 내부 임직원 (Microsoft Teams 사용자)
- 동시 접속 규모: 사내 중소 규모 (수십~수백 명)
- 사용 맥락: 업무 중 짧은 휴식, 팀 문화/소속감 형성, 가벼운 인터랙션

## Scope (범위)

### In Scope (포함)

- 손그림(마우스/터치) 자유 드로잉으로 물고기 생성
- Microsoft Teams JS SDK SSO 기반 로그인 세션 획득 및 신원 확인
- 이름 표시 물고기 / 익명 물고기 두 가지 등록 방식
- 실시간(WebSocket 등) 물고기 추가/삭제 전파 — 수동 새로고침 불필요
- 데이터베이스 영구 저장 (무기한 표시)
- 본인이 생성한 물고기 삭제 (익명 물고기 포함)
- 먹이주기 상호작용 및 물고기 정보 조회(클릭/호버)

### Out of Scope (제외 — 상세는 아래 Exclusions 참조)

- 물고기 편집/다시 그리기, 프리셋 물고기, 보존/정리 자동 정책(초기), 다중 어항 등

---

## Functional Requirements (EARS)

> EARS 패턴 표기: **[Ubiquitous]** 항시, **[Event]** 이벤트 기반(WHEN), **[State]** 상태 기반(WHILE), **[Unwanted]** 비정상 처리(IF...THEN), **[Optional]** 선택 기능(WHERE)

### 인증 (AUTH)

- **REQ-AUTH-001 [Event]**: 사용자가 Teams 탭 앱을 열 때(WHEN), 시스템은 Microsoft Teams JS SDK SSO를 통해 로그인 세션과 사용자 신원을 획득해야 한다(shall).
- **REQ-AUTH-002 [Ubiquitous]**: 시스템은 인증된 Teams 사용자 ID와 표시 이름을 모든 쓰기 작업(물고기 추가·삭제·먹이주기)의 신원 근거로 사용해야 한다.
- **REQ-AUTH-003 [Event]**: 사용자가 물고기를 추가할 때(WHEN), 시스템은 "이름 표시 물고기" 또는 "익명 물고기" 중 하나를 선택할 수 있게 제공해야 한다.
- **REQ-AUTH-004 [Unwanted]**: Teams SSO 토큰 획득 또는 검증에 실패하면(IF), 시스템은(THEN) 명확한 오류 상태와 재시도 경로를 안내하고, 물고기 생성·삭제·먹이주기 기능을 비활성화해야 한다.

### 물고기 생성 — 자유 드로잉 (DRAW)

- **REQ-DRAW-001 [Event]**: 사용자가 물고기 추가를 시작할 때(WHEN), 시스템은 마우스/터치로 자유롭게 그릴 수 있는 드로잉 캔버스를 제공해야 한다.
- **REQ-DRAW-002 [Ubiquitous]**: 시스템은 프리셋 물고기가 아니라 사용자가 직접 그린 그림을 물고기로 사용해야 한다.
- **REQ-DRAW-003 [Event]**: 사용자가 그린 물고기를 등록할 때(WHEN), 시스템은 그림을 저장 가능한 형식으로 캡처하고 어항에서 헤엄치도록 애니메이션 처리해야 한다.
- **REQ-DRAW-004 [Unwanted]**: 그림이 비어 있거나 유효하지 않으면(획 없음/최소 크기 미달 등)(IF), 시스템은(THEN) 등록을 거부하고 사용자에게 이유를 안내해야 한다.
- **REQ-DRAW-005 [State]**: 드로잉 캔버스가 활성인 동안(WHILE), 시스템은 실행 취소(undo)와 초기화(clear)를 제공해야 한다.

### 실시간 반영 (RT)

- **REQ-RT-001 [Event]**: 어떤 사용자가 새 물고기를 추가할 때(WHEN), 시스템은 실시간 채널(WebSocket 등)을 통해 접속 중인 모든 사용자의 어항에 해당 물고기를 즉시 반영해야 한다(수동 새로고침 없이).
- **REQ-RT-002 [Event]**: 물고기가 삭제될 때(WHEN), 시스템은 접속 중인 모든 사용자의 어항 뷰에서 해당 물고기를 실시간으로 제거해야 한다.
- **REQ-RT-003 [Unwanted]**: 실시간 연결이 끊기면(IF), 시스템은(THEN) 자동 재연결을 시도하고, 재연결 시 현재 어항 상태와 동기화해야 한다.
- **REQ-RT-004 [Event]**: 사용자가 어항에 진입할 때(WHEN), 시스템은 저장된 모든 물고기의 현재 상태를 로드하여 렌더링해야 한다.

### 영구 저장 (PERSIST)

- **REQ-PERSIST-001 [Ubiquitous]**: 시스템은 생성된 모든 물고기(그림 데이터, 소유자 ID, 표시 모드, 표시 이름, 생성 시각)를 데이터베이스에 영구 저장해야 한다.
- **REQ-PERSIST-002 [Ubiquitous]**: 시스템은 저장된 물고기를 무기한으로 어항에 표시해야 한다(초기 범위: 영구 보존).
- **REQ-PERSIST-003 [Optional]**: 향후 어항 과밀에 대한 정리/보존 정책이 도입되는 경우(WHERE), 시스템은 설정된 보존 정책에 따라 물고기를 정리할 수 있어야 한다. (초기 범위 밖 — 미래 확장 지점)

### 소유권 및 삭제 (OWN) — 익명 물고기 규칙 포함

- **REQ-OWN-001 [Ubiquitous]**: 시스템은 익명 물고기를 포함한 모든 물고기에 대해, 생성자의 인증된 Teams 사용자 ID를 내부 소유자 정보로 저장해야 한다(화면 표시 여부와 무관).
- **REQ-OWN-002 [Event]**: 로그인 사용자가 본인이 생성한 물고기의 삭제를 요청할 때(WHEN), 시스템은 이름 물고기와 익명 물고기를 구분 없이 해당 물고기를 삭제해야 한다.
- **REQ-OWN-003 [Unwanted]**: 사용자가 본인이 생성하지 않은 물고기의 삭제를 시도하면(IF), 시스템은(THEN) 삭제를 거부하고 권한 없음을 안내해야 한다.
- **REQ-OWN-004 [Ubiquitous]**: 시스템은 익명 물고기의 소유자 이름/신원을 다른 사용자 및 UI에 노출하지 않아야 한다. 내부 소유자 ID는 오직 삭제 권한 검증에만 사용해야 한다.
- **REQ-OWN-005 [Unwanted]**: 시스템은 물고기 편집 또는 다시 그리기 기능을 제공하지 않아야 한다(범위 외 — 삭제만 지원).

### 상호작용 (INT)

- **REQ-INT-001 [Event]**: 사용자가 어항에서 먹이주기를 실행할 때(WHEN), 시스템은 먹이 이벤트를 처리하고 물고기의 반응 애니메이션을 표시해야 한다.
- **REQ-INT-002 [Event]**: 사용자가 물고기를 클릭 또는 호버할 때(WHEN), 시스템은 해당 물고기의 정보(표시 이름 또는 "익명", 생성 시각 등)를 표시해야 한다.
- **REQ-INT-003 [Optional]**: 상호작용의 실시간 공유가 가능한 경우(WHERE), 시스템은 먹이주기 효과를 접속 중인 다른 사용자의 어항에도 반영할 수 있어야 한다.

---

## Non-Functional Requirements (NFR)

### 실시간 지연 (Latency)

- **NFR-RT-001 [Ubiquitous]**: 시스템은 물고기 추가/삭제 이벤트를 접속 사용자에게 낮은 지연으로 전파해야 한다. 목표: 사내망 기준 전파 지연 p95 ≤ 1초.

### 동시성/규모 (Concurrency & Scale)

- **NFR-CONC-001 [Ubiquitous]**: 시스템은 사내 중소 규모 동시 사용자(수십~수백 명)를 안정적으로 지원해야 한다.

### 렌더링 성능 (Rendering Performance)

- **NFR-PERF-001 [State]**: 어항에 다수(목표: 최소 수백 마리)의 물고기가 존재하는 동안(WHILE), 시스템은 프론트엔드 렌더링 성능 저하를 방지해야 한다(예: 렌더링 최적화/상한선 정책 적용, 목표 프레임레이트 유지).

### 보안 (Security — 사내이지만 인증 기반)

- **NFR-SEC-001 [Ubiquitous]**: 시스템은 모든 쓰기 작업에 대해 서버 측에서 Teams SSO 토큰을 검증하고 소유권을 확인해야 한다(클라이언트 값 신뢰 금지).
- **NFR-SEC-002 [Unwanted]**: 시스템은 위조/조작된 요청으로 타인의 물고기를 삭제하거나 신원을 위조하는 행위를 허용하지 않아야 한다.
- **NFR-SEC-003 [Ubiquitous]**: 시스템은 저장되는 그림 데이터에 대해 크기 제한 및 검증(정상 형식 여부, 스크립트 주입 방지)을 수행해야 한다.

### 접근성 (Accessibility)

- **NFR-A11Y-001 [Ubiquitous]**: 시스템은 드로잉 캔버스와 상호작용에 대해 접근성 대체 수단을 제공해야 한다(키보드 조작 경로, 명확한 라벨/안내 문구, 충분한 색 대비).

---

## Exclusions (What NOT to Build)

초기 범위에서 명시적으로 제외한다. (범위 크립 방지)

- **물고기 편집/다시 그리기**: 삭제만 지원한다 (REQ-OWN-005). 수정 기능은 만들지 않는다.
- **프리셋/템플릿 물고기 선택**: 오직 자유 손그림만 지원한다.
- **자동 보존/정리 정책 및 관리자 정리 UI**: 초기에는 영구 저장만 한다 (미래 확장은 REQ-PERSIST-003으로 표시).
- **다중 어항/룸 분리**: 단일 공용 어항만 제공한다.
- **소셜 기능**: 채팅, 댓글, 좋아요, 물고기 간 게임 메커니즘(번식/포식 등)은 만들지 않는다.
- **Teams 외부 독립 웹/모바일 네이티브 배포**: Teams 내장 탭 컨텍스트에서만 동작한다.
- **익명 물고기의 소유자 신원 공개 기능**: 익명 물고기의 실제 작성자를 조회/표시하는 기능은 만들지 않는다(내부 소유자 ID는 삭제 검증 전용).

---

## Assumptions (가정)

- Teams JS SDK SSO로 사내 사용자 신원(고유 사용자 ID, 표시 이름)을 확인할 수 있다.
- 프론트엔드 React, 백엔드 Node.js, 실시간 WebSocket, 영구 저장용 DB 엔진 사용(정확한 DB 엔진은 Run 단계 구현 결정 사항).
- 단일 공용 어항 상태를 전역으로 공유한다.

## Dependencies (의존성)

- Microsoft Teams JS SDK (SSO)
- 실시간 통신 인프라 (WebSocket 또는 동등 채널)
- 영구 저장 데이터베이스 (엔진 미정 — `.moai/config/sections/db.yaml` `db.engine: _TBD_`)

---

## Implementation Notes (구현 완료 요약, 2026-07-09)

Run 단계가 M1~M6 전 마일스톤에 대해 완료되었으며, 테스트 242개(client 128, server 114)가 통과했습니다.
실제 구현은 `plan.md` 의 기술 접근을 그대로 따랐고, 다음과 같이 구체화되었습니다.

- **DB 엔진 확정**: PostgreSQL(`pg`). `server/src/db/pool.js`(`DATABASE_URL` 기반), `server/migrations/001_create_fish.sql`(`fish` 테이블).
- **인증**: `@microsoft/teams-js` SSO → `jose` 로 서버 측 JWT 검증(`server/src/auth/`). 검증된 `oid` 클레임만 소유자 근거로 사용.
- **실시간**: `ws` 패키지 기반 WebSocket 게이트웨이(`server/src/realtime/`), 스냅샷(`GET /api/fish`) + 델타(WS `fish_added`/`fish_deleted`/`food_dropped`) + 재연결 시 재동기화.
- **저장소 추상화**: `FishRepository` 계약을 `InMemoryFishRepository`(테스트)와 `PgFishRepository`(프로덕션)가 각각 구현.
- **소유권 경계**: `toPublicFish`/`toViewerFish`(`server/src/fish/publicFish.js`)로 내부 `ownerId` 비노출을 코드 레벨에서 강제.
- **렌더링 성능(NFR-PERF-001)**: `MAX_ANIMATED`(200) 상한으로 동시 애니메이션 대상 제한, 상한 초과분은 정지 렌더.
- **접근성(NFR-A11Y-001)**: 캔버스 대체 키보드 경로, `role="alert"`/`role="status"` 라이브 영역, WCAG 2.1 AA 색 대비 토큰(`client/src/theme/`).

세부 API 형식과 아키텍처는 `docs/api.md`, `docs/architecture.md` 를 참조하십시오. SPEC 요구사항 대비 범위 변경(추가/축소)은 없습니다 — `plan.md`/`acceptance.md` 에 정의된 대로 구현되었습니다.
