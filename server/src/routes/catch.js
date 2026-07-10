// @MX:ANCHOR: [AUTO] 낚시/수집함 라우트 — 비파괴·프라이버시·스냅샷 불변식이 모이는 경계
// @MX:REASON: REQ-CATCH-003(비파괴), REQ-PRIV-002/003/004(비공개/스코프/신원 비노출),
//   NFR-SEC-002(서버 유도 스냅샷). 낚시는 원본 저장소에 읽기(findById)만 하고, 쓰기는 수집
//   저장소에만 한다. 브로드캐스터를 주입받지 않아 실시간 전파가 구조적으로 불가능하다(fan_in >= 3 예상).
import { Router } from "express";
import { toPublicCatch } from "../catch/publicCatch.js";

/**
 * 낚시(POST /fish/:id/catch)와 수집함 조회(GET /me/catches) 라우트를 만든다.
 * 브로드캐스터를 의도적으로 받지 않는다 — 낚시는 완전 비공개이며 실시간 전파가 없다(REQ-PRIV-002).
 * @param {{findById:Function}} fishRepository - 원본 물고기 저장소(읽기 전용 사용, REQ-CATCH-003).
 * @param {{create:Function, listByCatcher:Function, findByCatcherAndSource:Function}} catchRepository - 수집 저장소.
 */
export function catchRouter(fishRepository, catchRepository) {
  const router = Router();

  // 물고기 낚기. authRequired 를 통과했으므로 req.user 는 검증된 신원이다(NFR-SEC-001).
  router.post("/fish/:id/catch", async (req, res) => {
    // 원본 물고기를 읽기만 한다. 절대 update/delete 하지 않는다(비파괴 불변식, REQ-CATCH-003).
    const fish = await fishRepository.findById(req.params.id);

    // 원본이 없으면(삭제/미존재) 낚시 거부. 수집 항목을 만들지 않는다(REQ-CATCH-004).
    if (!fish) {
      return res.status(404).json({ error: { code: "not_found" } });
    }

    // 낚은 사람 신원은 검증된 토큰에서만 유도한다(NFR-SEC-001). 클라이언트 본문 신뢰 금지.
    const catcherId = req.user.userId;

    // 중복 낚기 멱등 처리: 이미 수집한 동일 원본이면 새로 삽입하지 않는다(REQ-CATCH-005).
    const existing = await catchRepository.findByCatcherAndSource(
      catcherId,
      fish.id,
    );
    if (existing) {
      return res
        .status(200)
        .json({ ...toPublicCatch(existing), alreadyCollected: true });
    }

    // 스냅샷은 전부 서버 저장 원본에서 유도한다(NFR-SEC-002). 요청 본문 콘텐츠는 무시한다.
    let saved;
    try {
      saved = await catchRepository.create({
        catcherId,
        sourceFishId: fish.id,
        drawing: fish.drawing,
        displayMode: fish.displayMode,
        displayName: fish.displayName ?? null,
      });
    } catch (err) {
      // 동시 낚기 레이스: dedupe 사전 체크를 둘 다 통과해 유니크 제약(catcher_id, source_fish_id)이
      // 위반되면(Postgres 23505) 500 대신 멱등 200 으로 처리한다(REQ-CATCH-005). 기존 행을 조회해 응답한다.
      if (err && err.code === "23505") {
        const already = await catchRepository.findByCatcherAndSource(
          catcherId,
          fish.id,
        );
        return res
          .status(200)
          .json({ ...toPublicCatch(already), alreadyCollected: true });
      }
      throw err;
    }

    // 공개 투영으로 원본 소유자 신원(ownerId)을 제거해 응답한다(REQ-PRIV-004).
    return res
      .status(201)
      .json({ ...toPublicCatch(saved), alreadyCollected: false });
  });

  // 내 수집함 조회. 인증된 본인(req.user.userId)으로만 스코프한다(REQ-PRIV-003, NFR-SEC-003).
  // 저장된 스냅샷으로 렌더링하며 원본을 재조회하지 않는다(REQ-COLL-003).
  router.get("/me/catches", async (req, res) => {
    const catches = await catchRepository.listByCatcher(req.user.userId);
    return res.status(200).json(catches.map(toPublicCatch));
  });

  return router;
}
