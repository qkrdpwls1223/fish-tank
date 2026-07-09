# 배포 가이드 — 10.10.33.36 (CTRDMZDEV, Docker)

기존 구성: docker-infra 프로젝트의 **nginx 가 80/443 점유**(TLS 종단),
**dnsmasq 가 사내 DNS(53)** 운영, 프로젝트 간 통신은 **shared-net** 사용.
fish-tank 는 nginx 뒤(내부 HTTP 3000)에 배치하고 전용 PostgreSQL 을 함께 띄운다.

```
[사용자 PC] --DNS(dnsmasq)--> 10.10.33.36
   Teams 탭 --HTTPS--> [nginx:443] --shared-net--> [fishtank-app:3000] --internal--> [fishtank-db:5432]
```

## 1. 이름 해석 — 각 PC hosts 등록

서버의 dnsmasq 는 현재 제대로 동작하지 않으므로, 기존 운영 방식대로
**각 사용자 PC 의 hosts 파일**에 등록한다:

```
10.10.33.36  fishtank.fllab.internal
```

(Windows: C:\Windows\System32\drivers\etc\hosts — 관리자 권한 필요.
추후 dnsmasq 를 복구하면 `address=/fishtank.fllab.internal/10.10.33.36`
한 줄로 hosts 배포를 대체할 수 있다.)

## 2. 인증서 준비

`fishtank.fllab.internal` 용 인증서/키를 기존 nginx 의 인증서 디렉터리에 배치.
사내 CA 또는 자체 CA 발급 — 루트 CA 는 각 PC 신뢰 저장소에 배포돼 있어야 한다.

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

1. `deploy/nginx-fishtank.conf` 를 기존 nginx 의 conf.d 마운트 디렉터리에 복사
   (인증서 경로를 실제 위치로 수정).
2. nginx 컨테이너가 `shared-net` 에 붙어 있는지 확인 — 안 붙어 있으면:
   `docker network connect shared-net nginx` (또는 docker-infra compose 에 추가).
3. 반영: `docker exec nginx nginx -t && docker exec nginx nginx -s reload`

## 5. 확인

```bash
curl -k https://fishtank.fllab.internal/healthz   # {"status":"ok"}
```

브라우저에서 https://fishtank.fllab.internal 접속 → 인증서 신뢰 확인(자물쇠)
→ Teams 패키지 업로드는 teams/README.md 참고.

## 업데이트 배포

```bash
cd ~/fish-tank && git pull
cd deploy && docker compose up -d --build
```
