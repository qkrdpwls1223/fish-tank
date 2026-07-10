# 구현 계획: SPEC-CATCH-001 물고기 낚시 & 개인 수집함

> 이 문서는 구현 방향(WHAT/WHY의 실행 계획)만 다룬다. 구체적 함수/클래스/스키마 설계는 Run 단계에서 확정한다. 시간 추정치는 사용하지 않으며 우선순위 기반으로 순서를 정한다.

## Technical Approach (기술 접근)

- **비파괴 원칙**: 낚시는 읽기 + 새 레코드 삽입만 수행한다. 원본 `fish` 테이블/레코드에 대한 UPDATE·DELETE는 절대 발생하지 않는다(REQ-CATCH-003). 코드 경로상 낚시 핸들러는 `fishRepository`의 `findById`만 호출하고, 쓰기는 새로운 catch 저장소에만 한다.
- **스냅샷 독립성**: 낚을 때 원본 물고기 레코드에서 `drawing`/`display_mode`/`display_name`을 읽어 `caught_fish` 행에 값으로 복사한다. `caught_fish`는 원본 `fish.id`를 dedupe 참조(`source_fish_id`)로만 보관하고, 외래키 cascade는 두지 않는다 → 원본 삭제와 무관하게 생존(REQ-SNAP-002/003).
- **프라이버시 경계**: 낚시/수집함은 실시간 브로드캐스터를 **호출하지 않는다**(REQ-PRIV-002). 수집함 조회는 `req.user.userId`로 스코프된 저장소 메서드(`listByCatcher`)만 사용한다(REQ-PRIV-003). 응답에는 `owner_id`를 포함하지 않으며(REQ-PRIV-004), 기존 공개 투영 원칙(`publicFish.js`)을 수집 응답에도 준용한다.
- **인증 재사용**: 새 라우트는 기존 `/api` 파이프라인의 `authRequired`를 통과시켜 `req.user.userId`(토큰 `oid`)를 낚은 사람 신원으로 사용한다. 클라이언트 본문의 신원 값은 신뢰하지 않는다(NFR-SEC-001).
- **입력 최소화**: 낚시 요청 본문은 콘텐츠를 받지 않고 URL의 원본 물고기 ID만 사용한다. 스냅샷은 전부 서버 저장 데이터에서 유도한다(NFR-SEC-002).
- **저장소 추상화**: 기존 `fishRepository`/`pgFishRepository` 계약 패턴을 따라, 인메모리(테스트)와 Postgres(프로덕션) 두 구현을 갖는 `caught_fish` 저장소 페어를 추가한다.
- **프론트엔드**: 공유 어항과 분리된 "내 수집함" 뷰를 상위 뷰 전환으로 추가하고, 어항에서 물고기를 낚는 트리거 UI(선택/버튼)를 붙인다. 낚시 후에도 어항 뷰의 원본은 그대로 유지됨을 시각적으로 보장한다.

## Milestones (우선순위 기반)

### M1 — 데이터 모델 및 스냅샷 저장소 (Priority: High)

- 새 `caught_fish` 마이그레이션(catch id, catcher_id, drawing/display_mode/display_name 스냅샷, source_fish_id, caught_at). 원본 `fish`에 대한 FK cascade 없음.
- catcher_id 및 (catcher_id, source_fish_id) 조회/중복 검사용 인덱스.
- 인메모리 + Postgres catch 저장소 페어(계약: create / listByCatcher / existsForCatcher).
- 커버 요구사항: REQ-SNAP-001, REQ-SNAP-003, NFR-COMPAT-001(기존 fish 스키마 무변경)

### M2 — 낚시 엔드포인트 (Priority: High)

- `POST /api/fish/:id/catch`(가칭): 원본 ID 수신 → `findById`로 조회 → 없으면 거부(REQ-CATCH-004) → 이미 수집됐으면 멱등 처리(REQ-CATCH-005) → 서버 데이터로 스냅샷 삽입(REQ-CATCH-001).
- 본인/타인 물고기 모두 낚기 허용(REQ-CATCH-002), 원본 무변경 보장(REQ-CATCH-003).
- 브로드캐스터 미호출(REQ-PRIV-002), 응답에 owner_id 비노출(REQ-PRIV-004).
- 커버 요구사항: REQ-CATCH-001~005, REQ-SNAP-002, REQ-PRIV-002, REQ-PRIV-004, NFR-SEC-001, NFR-SEC-002

### M3 — 수집함 조회 API (Priority: High)

- `GET /api/me/catches`(가칭): `req.user.userId`로 스코프된 본인 수집 목록 반환.
- 스냅샷 기반 응답(원본 재조회 없음), owner_id 비노출, 타인 수집함 접근 불가.
- 커버 요구사항: REQ-COLL-001, REQ-COLL-003, REQ-COLL-004, REQ-PRIV-001, REQ-PRIV-003, NFR-SEC-003, NFR-PRIV-001

### M4 — 프론트엔드 "내 수집함" 화면 + 낚시 인터랙션 (Priority: Medium)

- 공유 어항과 분리된 "내 수집함" 뷰(뷰 전환), 스냅샷 렌더링, 낚은 시각 등 메타데이터 표시, 빈 상태 처리.
- 어항에서 물고기를 낚는 트리거 UI. 낚은 후 어항 원본이 그대로 남음을 UX로 확인.
- 커버 요구사항: REQ-COLL-002, REQ-COLL-005, REQ-PRIV-001, REQ-CATCH-001/002(클라이언트 트리거)

### M5 — 접근성·성능·비회귀 검증 (Priority: Medium)

- 낚시/수집함 접근성 보조(키보드 경로, 라벨, 색 대비).
- 수집함 다수 렌더링 성능(상한/최적화 준용).
- SPEC-TANK-001 기존 동작 비회귀 확인(추가/삭제/먹이/실시간/투영이 낚시 도입으로 변하지 않음).
- 커버 요구사항: NFR-A11Y-001, NFR-PERF-001, NFR-COMPAT-001

## Risks (위험 요소)

- **비파괴 위반 회귀**: 낚시 경로가 실수로 원본을 수정/삭제. 완화: 낚시 핸들러는 원본 저장소에 읽기만 허용, 쓰기는 catch 저장소로 한정. 원본 불변 검증 테스트(낚기 전/후 `GET /api/fish` 스냅샷 동일)를 인수 기준에 포함.
- **스냅샷 결합도**: cascade FK를 잘못 걸면 원본 삭제 시 수집도 삭제. 완화: `caught_fish`에 FK cascade 금지, `source_fish_id`는 순수 참조값. "원본 삭제 후 수집 생존" 테스트로 증명(REQ-SNAP-002).
- **프라이버시 누출**: 수집 데이터가 공유 경로/브로드캐스트에 섞이거나 owner_id 노출. 완화: 낚시 경로에서 브로드캐스터 미사용, 수집 응답 투영에서 owner_id 제거(publicFish 원칙 준용), 타인 수집함 접근 차단 테스트.
- **중복 낚기 정책 모호성**: dedupe 미구현 시 동일 물고기 다중 항목. 완화: (catcher_id, source_fish_id) 유일성으로 멱등 처리(REQ-CATCH-005).
- **경계 조건**: 낚는 순간 원본이 삭제되는 경합. 완화: `findById` 결과가 없으면 낚시 거부(REQ-CATCH-004), 이미 삽입된 스냅샷은 원본 삭제와 무관하게 생존.

## Expert Consultation (권장 전문가 협의)

- 백엔드(새 저장소/엔드포인트, 스냅샷 독립성, 비파괴 보장): expert-backend 협의 권장
- 프론트엔드("내 수집함" 뷰, 낚시 트리거 UX, 캔버스 스냅샷 렌더링): expert-frontend 협의 권장
- 보안/프라이버시(스코프 조회, owner_id 비노출, 브로드캐스트 금지 경계): expert-security 협의 권장
