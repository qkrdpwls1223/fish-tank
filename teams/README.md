# Teams 앱 배포 가이드 (fishtank.formationlabs.co.kr)

호스트네임 `fishtank.formationlabs.co.kr` 은 회사 공인 도메인으로 등록되어
접속하며, PC별 hosts 파일 등록이 필요 없다(모바일 Teams 포함 정상 지원).

> 참고: 과거 사내 전용 도메인(`fishtank.fllab.internal`)을 쓸 때는 hosts 파일
> 등록이 필요했다. 그 방식으로 배포하는 경우가 아니라면 이 문서의 안내를
> 그대로 따르면 된다.

## 0. 사전 준비 체크리스트

| 항목 | 내용 |
|---|---|
| 서버 | Node 20+, PostgreSQL 접근 가능, 443(또는 지정 포트) 개방 |
| DNS | `fishtank.formationlabs.co.kr` → 서버 IP 공인 DNS A 레코드 등록 |
| 인증서 | `fishtank.formationlabs.co.kr` 대상 인증서(사내 CA 또는 Let's Encrypt 등) |
| Azure | 앱 등록 권한(또는 IT 요청), Teams 관리 센터 업로드 권한 |

## 1. Azure AD(Entra) 앱 등록

1. Azure Portal → 앱 등록 → 새 등록 → **애플리케이션(클라이언트) ID** 확보
2. **API 노출(Expose an API)**:
   - Application ID URI: `api://fishtank.formationlabs.co.kr/<클라이언트ID>`
     형태로 설정(공인 도메인이므로 커스텀 URI 등록 가능)
   - 스코프 추가: `access_as_user` (표시 이름/설명에만 브랜딩)
   - 권한 있는 클라이언트 앱 2개 등록(Teams 데스크톱/웹, 아래 3절 참고)
3. **권한 있는 클라이언트 애플리케이션** 2개 추가:
   - `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams 데스크톱/모바일)
   - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams 웹)
4. 테넌트 ID 확인

## 2. 서버 환경 변수 (server/.env)

```
DATABASE_URL=postgres://...
PORT=443
TEAMS_APP_CLIENT_ID=<1의 클라이언트 ID>
TEAMS_APP_ID_URI=api://fishtank.formationlabs.co.kr/<1의 클라이언트 ID>
TEAMS_TENANT_ID=<테넌트 ID>
TLS_CERT_PATH=<인증서 pem 경로>
TLS_KEY_PATH=<개인키 pem 경로>
# DEV_AUTH_BYPASS 는 프로덕션에서 반드시 제거
```

## 3. 빌드 및 실행

```bash
npm install
npm run build --workspace client          # client/dist 생성
psql "$DATABASE_URL" -f server/migrations/001_create_fish.sql
node server/src/server.js                 # dist 존재 시 정적 서빙 + TLS 종단
```

서버 하나가 정적 파일(`/`), API(`/api`), 실시간(`/realtime`)을 모두 서빙한다.
확인: `https://fishtank.formationlabs.co.kr/healthz` → `{"status":"ok"}`

## 4. Teams 앱 패키지 생성

```bash
node teams/build.mjs
```

- `server/.env` 의 `TEAMS_APP_CLIENT_ID` 를 읽어 매니페스트에 주입하고
  아이콘(color/outline)을 생성한 뒤 `teams/fishtank-teams.zip` 을 만든다.
- 아이콘을 교체하려면 `teams/dist/` 의 PNG 를 바꾸고 다시 zip 하면 된다.

## 5. Teams 업로드

- **조직 배포**: Teams 관리 센터 → Teams 앱 → 앱 관리 → 업로드 (관리자)
- **개인 테스트**: Teams → 앱 → 앱 관리 → "사용자 지정 앱 업로드"
  (테넌트 정책이 허용해야 함)

## 문제 해결

| 증상 | 확인 |
|---|---|
| 탭이 빈 화면 | 인증서가 PC 에서 신뢰되는지(브라우저로 직접 접속해 자물쇠 확인) |
| 로그인 실패 반복 | webApplicationInfo.resource ↔ Azure Application ID URI 일치 여부 |
| 401 응답 | 매니페스트 resource(api://fishtank.formationlabs.co.kr/<clientId>) ↔ Azure Application ID URI ↔ TENANT_ID 일치 확인 |
| WS 재연결 반복 | 프록시 없이 서버 직결인지, 443 방화벽 개방 여부 |
