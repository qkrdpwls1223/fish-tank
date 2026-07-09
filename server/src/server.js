// 서버 진입점 (프로덕션 실행). 테스트는 app.js/createApp 을 직접 사용한다.
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createApp } from "./app.js";
import { resolveVerifier } from "./auth/devAuth.js";
import { createPoolFromEnv } from "./db/pool.js";
import { PgFishRepository } from "./fish/pgFishRepository.js";
import { InMemoryBroadcaster } from "./realtime/broadcaster.js";
import { attachRealtime } from "./realtime/wsGateway.js";

const port = Number(process.env.PORT) || 3000;

// 환경 변수에서 검증 함수를 선택해 앱에 주입한다.
// 기본은 실제 Teams SSO 검증이며, DEV_AUTH_BYPASS(비프로덕션)일 때만 개발 우회를 쓴다.
const verify = resolveVerifier(process.env);
// 환경 변수(DATABASE_URL)로 PostgreSQL 저장소를 구성해 주입한다 (REQ-PERSIST-001).
const fishRepository = new PgFishRepository(createPoolFromEnv(process.env));
// 실시간 브로드캐스터를 앱과 WS 게이트웨이가 공유한다 (REQ-RT-001/002).
const broadcaster = new InMemoryBroadcaster();
const app = createApp({ verify, fishRepository, broadcaster });

// HTTP 서버 위에 WebSocket 게이트웨이를 얹는다. 클라이언트는 진입 시 GET /api/fish 로
// 스냅샷을 받고(REQ-RT-004), 이 WS 로 델타(추가/삭제)를 수신한다(REQ-RT-001/002/003).
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/realtime" });
attachRealtime({ wss, broadcaster, OPEN: WebSocket.OPEN });

httpServer.listen(port, () => {
  // eslint 없이도 안전한 최소 로깅.
  console.log(`fish-tank server listening on :${port}`);
});
