# 공유 어항 (fish-tank)

Microsoft Teams 내장 탭 앱. 임직원이 **직접 손으로 그린 물고기**를 **공용 어항**에 풀어놓고, 다른 사람이 그린 물고기가 함께 헤엄치는 모습을 **실시간**으로 감상·상호작용하는 사내 협업/휴식 경험을 제공합니다.

SPEC: `.moai/specs/SPEC-TANK-001/`

## 구조 (npm workspaces)

```
fish-tank/
  client/   React + Vite 프론트엔드 (Teams 탭, SSO, 드로잉/어항 렌더링)
  server/   Node.js + Express 백엔드 (Teams SSO 검증, 물고기 CRUD, 실시간)
  .env.example  필요한 환경 변수 문서 (실제 값은 .env 에)
```

## 기술 스택

- **프론트엔드**: React 18, Vite, `@microsoft/teams-js` (Teams JS SDK SSO)
- **백엔드**: Node.js, Express, `jose` (Teams SSO JWT/JWKS 검증), `pg` (PostgreSQL)
- **데이터베이스**: PostgreSQL (`DATABASE_URL` 환경 변수, 호스팅 미정). 물고기 레코드 영구 저장.
- **실시간**: WebSocket (`ws`). 진입 스냅샷 로드 후 추가/삭제/먹이 델타 전파, 끊김 시 자동 재연결·재동기화.
- **테스트**: Vitest (client·server 공통), supertest(server), Testing Library(client)

### 라이브러리 선택 근거

- **Express**: 광범위한 생태계, `supertest` 로 라우트 단위 테스트가 단순함.
- **pg (node-postgres)**: M1에는 스키마 작업이 없고, 단일 물고기 테이블 수준의 도메인에는
  코드 생성/빌드 단계가 있는 ORM보다 경량 SQL 클라이언트가 적합. `DATABASE_URL` 기반으로 직접 제어.
- **jose**: 표준 JWT/JWKS 검증. 원격 JWKS(`createRemoteJWKSet`)와 로컬 키셋 주입을 모두 지원하여
  위조 토큰으로 단위 테스트가 가능(라이브 테넌트 불필요).

## 개발 준비

```bash
npm install              # 루트에서 워크스페이스 전체 설치
cp .env.example .env     # 값 채우기 (비밀 값 커밋 금지)
```

## 테스트

```bash
npm test                 # client + server 전체
npm run test:server      # 서버만
npm run test:client      # 클라이언트만
```

## 실행 (개발)

```bash
npm run dev:server       # 백엔드 (기본 :3000)
npm run dev:client       # 프론트엔드 (Vite :5173)
```

## 로컬 개발용 로그인 우회 (Teams 없이 시험)

Teams 밖(일반 브라우저)에서 로그인·물고기 그리기를 시험하려면 개발 전용 우회를 켤 수 있습니다.
Teams SSO 는 Teams 클라이언트 안에서만 토큰을 발급하므로, 로컬 개발에서는 이 우회로 대체합니다.

`server/.env` 와 `client/.env`(또는 각 워크스페이스에서 읽는 `.env`)에 다음을 설정합니다.

```
DEV_AUTH_BYPASS=1          # 서버: 모든 요청을 고정 개발 신원으로 인증
VITE_DEV_AUTH_BYPASS=1     # 클라: Teams SSO 대신 개발 신원으로 바로 로그인
```

그다음 평소처럼 `npm run dev:server` 와 `npm run dev:client` 를 실행하면, 브라우저에서 바로
로그인된 상태로 물고기를 그리고 저장·실시간 반영을 확인할 수 있습니다. 서버는 우회가 켜지면
콘솔에 보안 경고를 출력합니다.

[경고] 이 우회는 **개발 전용**입니다.
- 두 플래그 모두 기본값은 비활성이며, 설정하지 않으면 실제 Teams SSO 검증을 사용합니다.
- 서버는 `NODE_ENV=production` 이면 `DEV_AUTH_BYPASS` 가 있어도 무시하고 실제 검증을 씁니다.
- 클라이언트 우회는 개발 빌드(`import.meta.env.DEV`)에서만 동작하며 프로덕션 번들에는 포함되지 않습니다.
- **프로덕션 배포 시 두 플래그를 반드시 비워두거나 제거하십시오.**

## 마일스톤 진행 상황

- [x] **M1 — 인증 및 앱 셸**: Teams SSO 세션 획득(클라이언트), 서버 측 토큰 검증 경계,
  인증 실패 시 오류 상태·재시도·기능 비활성화 (REQ-AUTH-001/002/004, NFR-SEC-001)
- [x] **M2 — 물고기 생성(드로잉) + 영구 저장**: 자유 드로잉 캔버스(undo/clear), 이름/익명 선택,
  사전 검증(빈/무효/크기), DB 영구 저장(소유자 ID 내부 저장) (REQ-DRAW-001~005, REQ-AUTH-003,
  REQ-OWN-001/004, REQ-PERSIST-001/002, NFR-SEC-003)
- [x] **M3 — 어항 렌더링 + 실시간 반영**: 진입 스냅샷 로드 + 헤엄 애니메이션, 추가/삭제 실시간 전파,
  끊김 시 자동 재연결·재동기화, 렌더링 상한(MAX_ANIMATED) (REQ-RT-001~004, NFR-RT-001, NFR-PERF-001)
- [x] **M4 — 삭제 및 소유권 규칙**: 본인 물고기(이름/익명 공통) 삭제, 타인 물고기 삭제 거부(서버 검증),
  삭제의 실시간 전파 (REQ-OWN-002/003/005, NFR-SEC-002)
- [x] **M5 — 상호작용**: 먹이주기(먹이 이벤트 + 반응 애니메이션 + 실시간 공유), 클릭/호버 정보 조회
  (익명은 "익명"으로만 표시) (REQ-INT-001/002/003)
- [x] **M6 — 접근성 및 마무리**: 키보드 조작 경로·접근성 라벨/설명·라이브 영역(먹이 안내 재낭독 포함)·
  WCAG 2.1 AA 색 대비 토큰, 동시성/규모 로직 검증(팬아웃·버스트 델타·렌더링 상한)
  (NFR-A11Y-001, NFR-CONC-001)

## 보안 경계 (NFR-SEC-001)

모든 쓰기 작업(물고기 추가·삭제·먹이주기)은 **서버 측에서 Teams SSO 토큰을 검증**한 인증 신원만
소유자 근거로 사용합니다. 클라이언트가 보낸 사용자 ID/이름은 신뢰하지 않습니다.

## 접근성 (NFR-A11Y-001)

- **키보드 조작 경로**: 모든 주요 액션(그리기 undo/clear/제출, 이름/익명 선택, 먹이 주기,
  물고기 선택·정보 조회, 본인 물고기 삭제, 인증 오류 재시도)은 네이티브 버튼/라디오로 제공되어
  키보드로 접근·조작 가능합니다.
- **캔버스 대체 수단**: 캔버스(어항/드로잉)는 포인터 전용이라 키보드로 직접 조작할 수 없으므로,
  `aria-describedby` 로 연결된 안내 문구와 물고기 목록/컨트롤이 대체 수단을 제공합니다.
- **라이브 영역**: 인증 오류는 `role="alert"`, 먹이 안내·물고기 수·정보 패널은 `role="status"` 로
  노출됩니다. 먹이 안내는 동일 문구를 반복해도 콘텐츠 키가 바뀌어 스크린리더가 매번 재낭독합니다.
- **색 대비(WCAG 2.1 AA)**: 컨트롤/텍스트 색은 `client/src/theme/colors.js` 토큰으로 관리하며,
  `client/src/theme/contrast.js` 의 대비 계산으로 AA(일반 4.5:1) 만족을 테스트로 검증합니다.
  (사용자가 그린 캔버스 그림은 대비 기준 예외.)

  | 토큰 | 값 | 표면(#ffffff) 대비 |
  |------|-----|-----|
  | text | `#1f2933` | 약 15.0:1 |
  | primary 위 onPrimary | `#ffffff` on `#1d4ed8` | 약 6.7:1 |
  | danger | `#b91c1c` | 약 6.5:1 |
  | muted | `#5b6672` | 약 5.8:1 |
