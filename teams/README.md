# Teams 앱 배포 가이드 (fishtank.fllab.internal)

호스트네임 `fishtank.fllab.internal` 은 사내 DNS 가 없으므로 **각 사용자 PC 의
hosts 파일**에 등록해 사용한다. Teams 클라이언트는 OS 이름 해석을 그대로 쓰므로
hosts 방식으로 동작한다(모바일 Teams 는 hosts 를 넣을 수 없어 미지원).

## 0. 사전 준비 체크리스트

| 항목 | 내용 |
|---|---|
| 서버 | Node 20+, PostgreSQL 접근 가능, 443(또는 지정 포트) 개방 |
| hosts 배포 | 각 PC: `<서버IP> fishtank.fllab.internal` |
| 인증서 | `fishtank.fllab.internal` 대상 인증서 + 각 PC가 루트 CA 신뢰 |
| Azure | 앱 등록 권한(또는 IT 요청), Teams 관리 센터 업로드 권한 |

## 1. Azure AD(Entra) 앱 등록

1. Azure Portal → 앱 등록 → 새 등록 → **애플리케이션(클라이언트) ID** 확보
2. **API 노출(Expose an API)**:
   - Application ID URI: `api://fishtank.fllab.internal/<클라이언트ID>`
   - 스코프 추가: `access_as_user`
3. **권한 있는 클라이언트 애플리케이션** 2개 추가:
   - `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams 데스크톱/모바일)
   - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams 웹)
4. 테넌트 ID 확인

## 2. 서버 환경 변수 (server/.env)

```
DATABASE_URL=postgres://...
PORT=443
TEAMS_APP_CLIENT_ID=<1의 클라이언트 ID>
TEAMS_APP_ID_URI=api://fishtank.fllab.internal/<클라이언트 ID>
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
확인: `https://fishtank.fllab.internal/healthz` → `{"status":"ok"}`

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
| 401 응답 | server/.env 의 TEAMS_APP_ID_URI / TENANT_ID 값과 토큰 aud/iss 비교 |
| WS 재연결 반복 | 프록시 없이 서버 직결인지, 443 방화벽 개방 여부 |
