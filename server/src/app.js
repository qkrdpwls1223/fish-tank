import path from "node:path";
import express from "express";
import { authRequired } from "./auth/authMiddleware.js";
import { meRouter } from "./routes/me.js";
import { fishRouter } from "./routes/fish.js";
import { catchRouter } from "./routes/catch.js";
import { InMemoryFishRepository } from "./fish/fishRepository.js";
import { InMemoryCatchRepository } from "./catch/catchRepository.js";
import { InMemoryBroadcaster } from "./realtime/broadcaster.js";

// Teams 클라이언트(데스크톱/웹)에서의 iframe 임베드만 허용하는 CSP.
// 직접 접속(최상위 탐색)은 막지 않으며, 제3자 사이트의 클릭재킹만 차단한다.
// Microsoft 공식 권장 프레이밍 도메인 전체를 포함한다. 특히 신규 통합 도메인
// *.cloud.microsoft(현행 Teams 웹 클라이언트가 여기서 임베드)가 빠지면 탭이 차단된다.
const FRAME_ANCESTORS_CSP =
  "frame-ancestors 'self' " +
  "https://teams.microsoft.com https://*.teams.microsoft.com " +
  "https://*.teams.microsoft.us https://local.teams.office.com " +
  "https://*.office.com https://*.microsoft365.com " +
  "https://*.cloud.microsoft https://*.skype.com";

/**
 * Express 앱을 구성한다.
 * @param {object} deps
 * @param {(token:string)=>Promise<object>} deps.verify - 주입된 토큰 검증 함수.
 * @param {{create:Function,list:Function}} [deps.fishRepository]
 *   물고기 저장소. 미주입 시 인메모리 구현을 사용한다(프로덕션은 Pg 구현 주입).
 * @param {{create:Function,listByCatcher:Function,findByCatcherAndSource:Function}} [deps.catchRepository]
 *   수집(낚시) 저장소. 미주입 시 인메모리 구현을 사용한다(프로덕션은 Pg 구현 주입).
 * @param {{broadcast:Function,subscribe:Function}} [deps.broadcaster]
 *   실시간 브로드캐스터. 미주입 시 인메모리 구현을 사용한다(REQ-RT-001).
 * @param {string} [deps.staticDir]
 *   클라이언트 빌드(dist) 디렉터리. 주입 시 정적 파일 + SPA 폴백을 서빙한다
 *   (프로덕션 단일 오리진 배포 — Teams 탭 contentUrl 이 이 서버를 가리킨다).
 * @returns {import('express').Express}
 */
export function createApp({
  verify,
  fishRepository = new InMemoryFishRepository(),
  catchRepository = new InMemoryCatchRepository(),
  broadcaster = new InMemoryBroadcaster(),
  staticDir,
}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // 공개 헬스체크 (인증 불필요).
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // 보호 라우트: authRequired 통과분만 접근 가능 (NFR-SEC-001 경계).
  app.use(
    "/api",
    authRequired(verify),
    meRouter(),
    fishRouter(fishRepository, broadcaster),
    // 낚시/수집함: 브로드캐스터 미주입 — 완전 비공개, 실시간 전파 없음(REQ-PRIV-002).
    catchRouter(fishRepository, catchRepository),
  );

  // 프로덕션: 클라이언트 빌드를 같은 오리진에서 서빙한다(Teams 탭 + WS 단일 도메인).
  if (staticDir) {
    app.use((_req, res, next) => {
      res.setHeader("Content-Security-Policy", FRAME_ANCESTORS_CSP);
      next();
    });
    app.use(express.static(staticDir));
    // SPA 폴백: API/실시간/헬스체크 외 경로는 index.html 로 응답한다.
    app.get("*", (req, res, next) => {
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/realtime") ||
        req.path === "/healthz"
      ) {
        return next();
      }
      return res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  return app;
}
