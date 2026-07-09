// @MX:ANCHOR: [AUTO] 물고기 라우트 — 인증·검증·소유권·영속성·실시간 전파가 모이는 경계
// @MX:REASON: NFR-SEC-001/002/003, REQ-OWN-001/004, REQ-RT-001/004. 생성은 검증된 신원만
//   소유자로 저장하고 공개 투영 후 브로드캐스트하며, 스냅샷 조회도 toPublicFish 로 투영해
//   내부 ownerId 를 절대 노출하지 않는다. 모든 읽기/쓰기가 이 경로를 통과한다.
import { Router } from "express";
import { validateDrawing } from "../fish/validateDrawing.js";
import { toPublicFish, toViewerFish } from "../fish/publicFish.js";
import {
  InMemoryBroadcaster,
  fishAddedEvent,
  fishDeletedEvent,
  foodDroppedEvent,
} from "../realtime/broadcaster.js";

const VALID_MODES = new Set(["named", "anonymous"]);

/**
 * 물고기 생성/조회/삭제 라우트를 만든다.
 * @param {{create:Function, list:Function, findById:Function, delete:Function}} fishRepository - 주입된 저장소.
 * @param {{broadcast:Function}} [broadcaster] - 실시간 브로드캐스터(REQ-RT-001/002).
 */
export function fishRouter(
  fishRepository,
  broadcaster = new InMemoryBroadcaster(),
) {
  const router = Router();

  // 진입 시 전체 스냅샷 로드 (REQ-RT-004). 요청 사용자 기준 toViewerFish 로 투영해
  // 내부 ownerId 는 감추고(REQ-OWN-004) 삭제 가능 여부(deletable)만 알려준다(REQ-OWN-002).
  router.get("/fish", async (req, res) => {
    const all = await fishRepository.list();
    return res
      .status(200)
      .json(all.map((f) => toViewerFish(f, req.user.userId)));
  });

  // 물고기 생성. authRequired 를 통과했으므로 req.user 는 검증된 신원이다.
  router.post("/fish", async (req, res) => {
    const { drawing, displayMode } = req.body ?? {};

    // 표시 모드 검증 (REQ-AUTH-003).
    if (!VALID_MODES.has(displayMode)) {
      return res
        .status(400)
        .json({ error: { code: "invalid_display_mode" } });
    }

    // 그림 데이터 서버측 검증 (NFR-SEC-003, REQ-DRAW-004). 클라이언트 불신.
    const { valid, reason } = validateDrawing(drawing);
    if (!valid) {
      return res
        .status(400)
        .json({ error: { code: "invalid_drawing", reason } });
    }

    // 소유자·표시 이름은 검증된 토큰에서만 유도한다 (NFR-SEC-002).
    // 익명이어도 내부 소유자 ID 저장 (REQ-OWN-001). 이름은 named 일 때만 노출.
    const stored = await fishRepository.create({
      drawing,
      ownerId: req.user.userId,
      displayMode,
      displayName: displayMode === "named" ? req.user.displayName : null,
    });

    // 공개 투영(ownerId 제거) 후 실시간 전파 (REQ-RT-001, REQ-OWN-004).
    // 브로드캐스트는 전 사용자 공용이므로 deletable 없는 공개 형식만 담는다.
    const publicFish = toPublicFish(stored);
    broadcaster.broadcast(fishAddedEvent(publicFish));

    // 생성자 응답은 뷰어 투영으로 내려 본인 소유(deletable:true)를 즉시 알린다.
    return res.status(201).json(toViewerFish(stored, req.user.userId));
  });

  // @MX:ANCHOR: [AUTO] 삭제 권한 검증 — 소유권 경계(서버가 유일한 권위)
  // @MX:REASON: NFR-SEC-002, REQ-OWN-002/003. 클라이언트의 소유권 주장은 절대 신뢰하지 않고
  //   검증된 토큰 신원(req.user.userId)과 저장된 내부 ownerId 만 비교한다. 익명 물고기도
  //   동일 규칙으로 본인만 삭제 가능하며, 거부/404 응답에 소유자 신원을 노출하지 않는다(REQ-OWN-004).
  router.delete("/fish/:id", async (req, res) => {
    const fish = await fishRepository.findById(req.params.id);

    // 대상이 없으면 404. (존재 여부만 알리고 소유자 정보는 노출하지 않는다.)
    if (!fish) {
      return res.status(404).json({ error: { code: "not_found" } });
    }

    // 소유권 검증: 검증된 토큰 신원만 사용한다. body 의 ownerId 주장은 무시한다(NFR-SEC-002).
    if (fish.ownerId !== req.user.userId) {
      return res.status(403).json({ error: { code: "forbidden" } });
    }

    await fishRepository.delete(fish.id);

    // 삭제 성공 시 id 만 담아 전 사용자에게 실시간 전파 (REQ-RT-002).
    broadcaster.broadcast(fishDeletedEvent(fish.id));

    return res.status(204).end();
  });

  // 먹이주기 실시간 공유 (REQ-INT-001, REQ-INT-003). authRequired 를 통과했으므로
  // req.user 는 검증된 신원이다. 그러나 먹이 이벤트에는 좌표만 담고 신원은 절대 노출하지
  // 않는다(REQ-OWN-004). 먹이는 저장하지 않는 임시 효과라 영속성/소유권 저장이 없다.
  router.post("/feed", (req, res) => {
    const { x, y } = req.body ?? {};

    // 좌표 검증: 클라이언트 값을 신뢰하지 않고 숫자만 허용한다(NFR-SEC-003 취지).
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: { code: "invalid_food" } });
    }

    broadcaster.broadcast(foodDroppedEvent({ x, y }));
    return res.status(200).json({ ok: true });
  });

  return router;
}
