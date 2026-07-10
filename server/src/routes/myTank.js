// @MX:ANCHOR: [AUTO] 내 어항(개인 어항) 라우트 — 프라이버시·소유자 스코프·검증이 모이는 경계
// @MX:REASON: NFR-SEC-001/002/003. 개인 어항은 소유자 전용이라 모든 읽기/변경/삭제를
//   검증된 토큰 신원(req.user.userId)으로만 스코프한다. 브로드캐스터를 주입받지 않아 실시간
//   전파가 구조적으로 불가능하다(공유 어항과 완전 격리). 모든 읽기는 공개 투영을 통과한다(fan_in >= 3 예상).
import { Router } from "express";
import { validateDrawing } from "../fish/validateDrawing.js";
import { toPublicMyTankFish, toPublicMyTankDecor } from "../mytank/publicMyTank.js";
import { SCALE_DEFAULT, isValidScale } from "../mytank/scale.js";

const VALID_MODES = new Set(["named", "anonymous"]);

// 장식 종류 화이트리스트. 클라이언트 값을 신뢰하지 않고 허용 목록만 통과시킨다(NFR-SEC-003).
const VALID_DECOR_KINDS = new Set(["seaweed", "rock", "castle"]);

// 좌표는 유한한 숫자만 허용한다(NaN/Infinity/문자열 배제). 클라이언트 불신.
function validPosition(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

// 생성 시 scale 을 해석한다. 미지정이면 기본값, 지정되면 범위를 검증한다.
// 반환: { ok: true, scale } | { ok: false } (400 invalid_scale 로 응답)
function resolveCreateScale(raw) {
  if (raw === undefined) return { ok: true, scale: SCALE_DEFAULT };
  if (!isValidScale(raw)) return { ok: false };
  return { ok: true, scale: raw };
}

/**
 * 내 어항 라우트를 만든다. 브로드캐스터를 의도적으로 받지 않는다 — 개인 어항은 완전 비공개이며
 * 실시간 전파가 없다. 모든 작업은 인증된 본인(req.user.userId)으로 스코프된다.
 * @param {{
 *   createFish:Function, listFishByOwner:Function, updateFishPosition:Function, deleteFish:Function,
 *   createDecor:Function, listDecorByOwner:Function, updateDecorPosition:Function, deleteDecor:Function
 * }} myTankRepository - 주입된 내 어항 저장소.
 */
export function myTankRouter(myTankRepository) {
  const router = Router();

  // 내 어항 전체 조회. 호출자 본인 소유만 반환한다(스코프). 공개 투영으로 ownerId 를 감춘다.
  router.get("/my-tank", async (req, res) => {
    const ownerId = req.user.userId;
    const [fish, decor] = await Promise.all([
      myTankRepository.listFishByOwner(ownerId),
      myTankRepository.listDecorByOwner(ownerId),
    ]);
    return res.status(200).json({
      fish: fish.map(toPublicMyTankFish),
      decor: decor.map(toPublicMyTankDecor),
    });
  });

  // 개인 어항에 물고기를 그려 넣는다. 공유 어항으로 공유하지 않고 브로드캐스트하지 않는다.
  router.post("/my-tank/fish", async (req, res) => {
    const { drawing, displayMode, x, y, scale } = req.body ?? {};

    if (!VALID_MODES.has(displayMode)) {
      return res.status(400).json({ error: { code: "invalid_display_mode" } });
    }
    const { valid, reason } = validateDrawing(drawing);
    if (!valid) {
      return res.status(400).json({ error: { code: "invalid_drawing", reason } });
    }
    if (!validPosition(x, y)) {
      return res.status(400).json({ error: { code: "invalid_position" } });
    }
    const scaleResult = resolveCreateScale(scale);
    if (!scaleResult.ok) {
      return res.status(400).json({ error: { code: "invalid_scale" } });
    }

    // 소유자·표시 이름은 검증된 토큰에서만 유도한다(NFR-SEC-002). 클라이언트 displayName 은 무시한다.
    const stored = await myTankRepository.createFish({
      ownerId: req.user.userId,
      drawing,
      displayMode,
      displayName: displayMode === "named" ? req.user.displayName : null,
      x,
      y,
      scale: scaleResult.scale,
    });
    return res.status(201).json(toPublicMyTankFish(stored));
  });

  // 본인 물고기 이동. 본인 소유가 아니면 404(존재 여부/소유자 신원을 누출하지 않는다).
  router.patch("/my-tank/fish/:id", async (req, res) => {
    const { x, y, scale } = req.body ?? {};
    if (!validPosition(x, y)) {
      return res.status(400).json({ error: { code: "invalid_position" } });
    }
    // scale 은 선택이지만, 주어졌다면 범위를 만족해야 한다.
    if (scale !== undefined && !isValidScale(scale)) {
      return res.status(400).json({ error: { code: "invalid_scale" } });
    }
    const updated = await myTankRepository.updateFishPosition({
      id: req.params.id,
      ownerId: req.user.userId,
      x,
      y,
      scale,
    });
    if (!updated) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    return res.status(200).json(toPublicMyTankFish(updated));
  });

  // 본인 물고기 삭제. 본인 소유가 아니면 404.
  router.delete("/my-tank/fish/:id", async (req, res) => {
    const removed = await myTankRepository.deleteFish({
      id: req.params.id,
      ownerId: req.user.userId,
    });
    if (!removed) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    return res.status(204).end();
  });

  // 장식 추가. 종류 화이트리스트/좌표를 검증한다.
  router.post("/my-tank/decor", async (req, res) => {
    const { kind, x, y, scale } = req.body ?? {};
    if (!VALID_DECOR_KINDS.has(kind)) {
      return res.status(400).json({ error: { code: "invalid_kind" } });
    }
    if (!validPosition(x, y)) {
      return res.status(400).json({ error: { code: "invalid_position" } });
    }
    const scaleResult = resolveCreateScale(scale);
    if (!scaleResult.ok) {
      return res.status(400).json({ error: { code: "invalid_scale" } });
    }
    const stored = await myTankRepository.createDecor({
      ownerId: req.user.userId,
      kind,
      x,
      y,
      scale: scaleResult.scale,
    });
    return res.status(201).json(toPublicMyTankDecor(stored));
  });

  // 본인 장식 이동. 본인 소유가 아니면 404.
  router.patch("/my-tank/decor/:id", async (req, res) => {
    const { x, y, scale } = req.body ?? {};
    if (!validPosition(x, y)) {
      return res.status(400).json({ error: { code: "invalid_position" } });
    }
    if (scale !== undefined && !isValidScale(scale)) {
      return res.status(400).json({ error: { code: "invalid_scale" } });
    }
    const updated = await myTankRepository.updateDecorPosition({
      id: req.params.id,
      ownerId: req.user.userId,
      x,
      y,
      scale,
    });
    if (!updated) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    return res.status(200).json(toPublicMyTankDecor(updated));
  });

  // 본인 장식 삭제. 본인 소유가 아니면 404.
  router.delete("/my-tank/decor/:id", async (req, res) => {
    const removed = await myTankRepository.deleteDecor({
      id: req.params.id,
      ownerId: req.user.userId,
    });
    if (!removed) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    return res.status(204).end();
  });

  return router;
}
