import express from "express";
import { authRequired } from "./auth/authMiddleware.js";
import { meRouter } from "./routes/me.js";
import { fishRouter } from "./routes/fish.js";
import { InMemoryFishRepository } from "./fish/fishRepository.js";
import { InMemoryBroadcaster } from "./realtime/broadcaster.js";

/**
 * Express 앱을 구성한다.
 * @param {object} deps
 * @param {(token:string)=>Promise<object>} deps.verify - 주입된 토큰 검증 함수.
 * @param {{create:Function,list:Function}} [deps.fishRepository]
 *   물고기 저장소. 미주입 시 인메모리 구현을 사용한다(프로덕션은 Pg 구현 주입).
 * @param {{broadcast:Function,subscribe:Function}} [deps.broadcaster]
 *   실시간 브로드캐스터. 미주입 시 인메모리 구현을 사용한다(REQ-RT-001).
 * @returns {import('express').Express}
 */
export function createApp({
  verify,
  fishRepository = new InMemoryFishRepository(),
  broadcaster = new InMemoryBroadcaster(),
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
  );

  return app;
}
