# 배포 가이드 — 10.10.33.36 (CTRDMZDEV, Docker)

기존 구성: docker-infra 프로젝트의 **nginx 가 80/443 점유**(TLS 종단),
프로젝트 간 통신은 **shared-net** 사용.
fish-tank 는 nginx 뒤(내부 HTTP 3000)에 배치하고 전용 PostgreSQL 을 함께 띄운다.

```
[사용자 PC] --공인 DNS--> 10.10.33.36
   브라우저 --HTTPS--> [nginx:443] --shared-net--> [fishtank-app:3000] --internal--> [fishtank-db:5432]
```

## 1. 이름 해석 — 공인 DNS 등록

`fishtank.formationlabs.co.kr` 은 회사 공인 도메인이므로, 사내 DNS 담당자에게
아래 A 레코드 등록을 요청한다(각 PC hosts 파일 수동 등록 불필요):

```
fishtank.formationlabs.co.kr.  A  10.10.33.36
```

(참고: 과거 `fishtank.fllab.internal` 사내 전용 도메인을 쓸 때는 hosts 파일
수동 등록이 필요했다. 그때 배포한 `add-hosts.bat`/`remove-hosts.bat` 는 현재
배포에서는 사용하지 않는다 — 자세한 내용은 `USER-SETUP.md` 참고.)

## 2. 인증서 — 별도 발급 필요

`formationlabs.co.kr` 은 기존 `*.fllab.internal` 와일드카드 인증서로 커버되지
않으므로, `fishtank.formationlabs.co.kr` 전용 인증서를 별도로 준비해야 한다
(사내 CA 발급 또는 Let's Encrypt 등). 발급받은 인증서는
`deploy/nginx-fishtank.conf` 의 `ssl_certificate`/`ssl_certificate_key` 경로에
맞춰 배치한다(현재 파일은 placeholder 경로로 되어 있으니 실제 경로로 교체).

## 3. 소스 반입 및 기동

서버에서 (GitLab 이 이미 있으므로 push/clone 경로 권장):

```bash
git clone <레포 URL> ~/fish-tank
cd ~/fish-tank/deploy
cp .env.example .env    # FISHTANK_DB_PASSWORD, TEAMS_APP_CLIENT_ID, TEAMS_TENANT_ID 기입
docker compose up -d --build
docker compose ps       # fishtank-app healthy 확인
```

- DB 스키마는 최초 기동 시 `server/migrations/` 가 자동 적용된다.
- 앱은 호스트 포트를 열지 않는다 — nginx 를 통해서만 접근.

## 4. nginx 가상 호스트 추가

nginx 와 fishtank-app 은 이미 `shared-net` 에 함께 있어 이름 해석이 된다(추가 연결 불필요).

```bash
cp ~/fish-tank/deploy/nginx-fishtank.conf \
   ~/docker-infra/nginx/conf.d/site-fishtank.conf
docker exec nginx nginx -t          # 문법 검증
docker exec nginx nginx -s reload   # 무중단 반영
```

- 인증서 경로는 2단계에서 준비한 실제 경로로 `nginx-fishtank.conf` 를 수정한 뒤 복사한다.
- 이 vhost 는 의도적으로 `security-headers.conf` 를 include 하지 않는다 —
  그 파일의 `X-Frame-Options: DENY` 가 Teams 임베드를 막기 때문. 프레임 정책은
  앱의 `frame-ancestors` CSP 가 담당한다(자세한 내용은 conf 파일 주석 참고).

## 5. 확인

```bash
curl https://fishtank.formationlabs.co.kr/healthz   # {"status":"ok"}
```

브라우저에서 https://fishtank.formationlabs.co.kr 접속 → 인증서 신뢰 확인(자물쇠)
→ Microsoft 로그인 페이지로 리다이렉트 → 회사 계정 로그인 후 어항 표시.

## 6. Azure 앱 등록 (Microsoft SSO — 브라우저 로그인)

Teams 앱 배포는 중단했고, 일반 브라우저에서 MSAL.js 리다이렉트 로그인으로
Microsoft SSO 를 유지한다. Azure Portal 의 기존 앱 등록에서 아래를 확인한다:

1. **인증 > 플랫폼 추가 > 단일 페이지 애플리케이션(SPA)** 에 리다이렉트 URI
   `https://fishtank.formationlabs.co.kr` 등록.
2. **API 노출(Expose an API)** 에 `access_as_user` 스코프가 있는지 확인
   (Teams SSO 시절 만든 `api://fishtank.formationlabs.co.kr/<client-id>` 그대로 사용).
3. 클라이언트 설정(클라이언트 ID/테넌트 ID/Application ID URI)은
   `deploy/docker-compose.yml` 의 build args 로 빌드 시점에 주입된다 —
   `.env` 의 `TEAMS_APP_CLIENT_ID`, `TEAMS_TENANT_ID` 만 채우면 된다.

로그인은 회사 테넌트(authority 고정) + 서버 issuer/audience 검증으로
회사 Microsoft 계정만 허용된다.

## 업데이트 배포

```bash
cd ~/fish-tank && git pull
cd deploy && docker compose up -d --build
```
