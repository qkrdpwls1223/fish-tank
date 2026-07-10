// 서버 진입점 (프로덕션 실행). 테스트는 app.js/createApp 을 직접 사용한다.
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { createApp } from "./app.js";
import { resolveVerifier } from "./auth/devAuth.js";
import { createPoolFromEnv } from "./db/pool.js";
import { PgFishRepository } from "./fish/pgFishRepository.js";
import { PgCatchRepository } from "./catch/pgCatchRepository.js";
import { PgMyTankRepository } from "./mytank/pgMyTankRepository.js";
import { InMemoryBroadcaster } from "./realtime/broadcaster.js";
import { attachRealtime } from "./realtime/wsGateway.js";

const port = Number(process.env.PORT) || 3000;

// 클라이언트 빌드 산출물 위치. 존재할 때만 정적 서빙을 켠다(개발은 Vite 가 담당).
// STATIC_DIR 환경 변수로 재지정 가능.
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir =
  process.env.STATIC_DIR ?? path.resolve(here, "../../client/dist");
const serveStatic = existsSync(staticDir);

// 환경 변수에서 검증 함수를 선택해 앱에 주입한다.
// 기본은 실제 Teams SSO 검증이며, DEV_AUTH_BYPASS(비프로덕션)일 때만 개발 우회를 쓴다.
const verify = resolveVerifier(process.env);
// 환경 변수(DATABASE_URL)로 PostgreSQL 풀을 구성해 저장소들이 공유한다 (REQ-PERSIST-001).
const pool = createPoolFromEnv(process.env);
const fishRepository = new PgFishRepository(pool);
// 개인 수집함 저장소 (SPEC-CATCH-001, REQ-SNAP-001). 같은 풀을 재사용한다.
const catchRepository = new PgCatchRepository(pool);
// 내 어항(개인 어항) 저장소. 같은 풀을 재사용한다. 소유자 전용·공유 어항과 격리.
const myTankRepository = new PgMyTankRepository(pool);
// 실시간 브로드캐스터를 앱과 WS 게이트웨이가 공유한다 (REQ-RT-001/002).
// 낚시/수집함은 이 브로드캐스터를 사용하지 않는다 — 완전 비공개(REQ-PRIV-002).
const broadcaster = new InMemoryBroadcaster();
const app = createApp({
  verify,
  fishRepository,
  catchRepository,
  myTankRepository,
  broadcaster,
  staticDir: serveStatic ? staticDir : undefined,
});

// TLS_CERT_PATH/TLS_KEY_PATH 가 설정되면 HTTPS 로 직접 종단한다.
// (Teams 는 HTTPS 필수. 앞단에 별도 리버스 프록시가 있다면 미설정으로 HTTP 유지.)
const { TLS_CERT_PATH, TLS_KEY_PATH } = process.env;
const useTls = Boolean(TLS_CERT_PATH && TLS_KEY_PATH);
const httpServer = useTls
  ? createHttpsServer(
      { cert: readFileSync(TLS_CERT_PATH), key: readFileSync(TLS_KEY_PATH) },
      app,
    )
  : createHttpServer(app);

// HTTP(S) 서버 위에 WebSocket 게이트웨이를 얹는다. 클라이언트는 진입 시 GET /api/fish 로
// 스냅샷을 받고(REQ-RT-004), 이 WS 로 델타(추가/삭제)를 수신한다(REQ-RT-001/002/003).
const wss = new WebSocketServer({ server: httpServer, path: "/realtime" });
attachRealtime({ wss, broadcaster, OPEN: WebSocket.OPEN });

httpServer.listen(port, () => {
  // eslint 없이도 안전한 최소 로깅.
  console.log(
    `fish-tank server listening on :${port}` +
      ` (tls=${useTls ? "on" : "off"}, static=${serveStatic ? staticDir : "off"})`,
  );
});
