import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { verifyTeamsToken } from "../auth/verifyTeamsToken.js";
import { InMemoryFishRepository } from "../fish/fishRepository.js";
import { InMemoryCatchRepository } from "../catch/catchRepository.js";
import { InMemoryBroadcaster } from "../realtime/broadcaster.js";
import {
  createKeyMaterial,
  makeToken,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from "../../test/helpers/tokens.js";

// SPEC-CATCH-001 낚시/수집함 통합 테스트.
// 커버: REQ-CATCH-001~005, REQ-COLL-001/003/004/005, REQ-PRIV-001~004,
//       REQ-SNAP-001/002/003, NFR-SEC-001/002/003, NFR-COMPAT-001.

function validDrawing() {
  return {
    version: 1,
    width: 300,
    height: 200,
    strokes: [
      {
        color: "#112233",
        width: 3,
        points: [
          { x: 10, y: 10 },
          { x: 80, y: 60 },
          { x: 140, y: 20 },
        ],
      },
    ],
  };
}

describe("POST /api/fish/:id/catch (낚시)", () => {
  let privateKey;
  let verify;
  let fishRepo;
  let catchRepo;
  let broadcaster;
  let app;

  beforeAll(async () => {
    const { privateKey: pk, jwks } = await createKeyMaterial();
    privateKey = pk;
    verify = (token) =>
      verifyTeamsToken(token, {
        jwks,
        audience: TEST_AUDIENCE,
        issuer: TEST_ISSUER,
      });
  });

  beforeEach(() => {
    fishRepo = new InMemoryFishRepository();
    catchRepo = new InMemoryCatchRepository();
    broadcaster = new InMemoryBroadcaster();
    app = createApp({
      verify,
      fishRepository: fishRepo,
      catchRepository: catchRepo,
      broadcaster,
    });
  });

  // 타인 소유 물고기를 어항에 저장한다.
  async function othersFish(overrides = {}) {
    return fishRepo.create({
      drawing: validDrawing(),
      ownerId: "someone-else-999",
      displayMode: "named",
      displayName: "남물고기",
      ...overrides,
    });
  }

  it("타인 물고기를 낚으면 201 과 스냅샷 사본을 수집함에 추가한다 (REQ-CATCH-001, REQ-CATCH-002)", async () => {
    const fish = await othersFish();
    const token = await makeToken(privateKey); // oid = user-oid-123

    const res = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("string");
    expect(res.body.sourceFishId).toBe(fish.id);
    expect(res.body.drawing).toEqual(validDrawing());
    expect(res.body.displayMode).toBe("named");
    expect(res.body.displayName).toBe("남물고기");
    expect(res.body.caughtAt).toBeTypeOf("string");

    const mine = await catchRepo.listByCatcher("user-oid-123");
    expect(mine).toHaveLength(1);
    expect(mine[0].sourceFishId).toBe(fish.id);
  });

  it("본인이 그린 물고기도 낚을 수 있다 (REQ-CATCH-002)", async () => {
    const fish = await fishRepo.create({
      drawing: validDrawing(),
      ownerId: "user-oid-123",
      displayMode: "named",
      displayName: "내물고기",
    });
    const token = await makeToken(privateKey);

    const res = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(await catchRepo.listByCatcher("user-oid-123")).toHaveLength(1);
  });

  it("낚시는 원본 물고기를 삭제·변경하지 않는다 — 비파괴 (REQ-CATCH-003)", async () => {
    const fish = await othersFish();
    const token = await makeToken(privateKey);

    const before = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${token}`);

    await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    const after = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${token}`);

    // 낚기 전/후 공유 어항 스냅샷이 완전히 동일하다.
    expect(after.body).toEqual(before.body);
    // 원본 레코드도 저장소에 그대로 존재한다.
    expect(await fishRepo.findById(fish.id)).not.toBeNull();
  });

  it("낚시는 실시간 브로드캐스터를 절대 호출하지 않는다 — 완전 비공개 (REQ-PRIV-001, REQ-PRIV-002)", async () => {
    const fish = await othersFish();
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(listener).not.toHaveBeenCalled();
  });

  it("낚시 응답에 원본 내부 owner_id 를 노출하지 않는다 (REQ-PRIV-004)", async () => {
    const fish = await othersFish({ displayMode: "anonymous", displayName: null });
    const token = await makeToken(privateKey);

    const res = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect("ownerId" in res.body).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("someone-else-999");
    // 익명 물고기는 신원이 드러나지 않는다.
    expect(res.body.displayMode).toBe("anonymous");
    expect(res.body.displayName).toBeNull();
  });

  it("스냅샷은 클라이언트 본문이 아니라 서버 저장 원본에서만 유도한다 (NFR-SEC-002)", async () => {
    const fish = await othersFish();
    const token = await makeToken(privateKey);

    // 공격자가 임의 콘텐츠를 본문에 실어도 무시되어야 한다.
    const res = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        drawing: { version: 1, width: 9, height: 9, strokes: [] },
        displayName: "조작된이름",
        displayMode: "anonymous",
      });

    expect(res.status).toBe(201);
    // 서버 저장 원본 값이 그대로 스냅샷으로 저장된다(본문 무시).
    expect(res.body.drawing).toEqual(validDrawing());
    expect(res.body.displayName).toBe("남물고기");
    expect(res.body.displayMode).toBe("named");
  });

  it("존재하지 않는(삭제된) 물고기 낚기는 404 이며 수집함에 항목을 만들지 않는다 (REQ-CATCH-004)", async () => {
    const token = await makeToken(privateKey);

    const res = await request(app)
      .post(`/api/fish/does-not-exist/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
    expect(await catchRepo.listByCatcher("user-oid-123")).toHaveLength(0);
  });

  it("이미 수집한 동일 원본을 다시 낚으면 멱등 처리하고 중복을 만들지 않는다 (REQ-CATCH-005)", async () => {
    const fish = await othersFish();
    const token = await makeToken(privateKey);

    const first = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);
    const second = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(first.status).toBe(201);
    expect(first.body.alreadyCollected).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.alreadyCollected).toBe(true);
    // 동일 수집 항목을 가리킨다(중복 삽입 없음).
    expect(second.body.id).toBe(first.body.id);
    expect(await catchRepo.listByCatcher("user-oid-123")).toHaveLength(1);
  });

  it("동시 낚기로 유니크 제약(23505)이 발생해도 500 이 아니라 200 멱등 응답을 반환한다 (REQ-CATCH-005, 레이스 안전)", async () => {
    const fish = await othersFish();
    const token = await makeToken(privateKey); // oid = user-oid-123

    // 첫 create 로 만들어졌을 기존 수집 행(충돌 후 폴백 조회로 반환될 값).
    const existingRow = {
      id: "existing-catch-1",
      catcherId: "user-oid-123",
      sourceFishId: fish.id,
      drawing: validDrawing(),
      displayMode: "named",
      displayName: "남물고기",
      caughtAt: "2026-07-10T00:00:00.000Z",
    };

    // 레이스 시뮬레이션: 사전 dedupe 체크에서는 아직 행이 안 보이고(null),
    // create 는 유니크 위반(23505)을 던진다. 그 후 폴백 조회에서는 기존 행이 보인다.
    let preCheckDone = false;
    const racingCatchRepo = {
      async findByCatcherAndSource() {
        if (!preCheckDone) {
          preCheckDone = true;
          return null; // 동시 요청 둘 다 dedupe 를 통과하는 상황
        }
        return { ...existingRow }; // 충돌 후 폴백 조회
      },
      async create() {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      },
      async listByCatcher() {
        return [{ ...existingRow }];
      },
    };

    const raceApp = createApp({
      verify,
      fishRepository: fishRepo,
      catchRepository: racingCatchRepo,
      broadcaster,
    });

    const res = await request(raceApp)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyCollected).toBe(true);
    expect(res.body.id).toBe("existing-catch-1");
  });

  it("토큰이 없으면 401 이며 수집하지 않는다 (NFR-SEC-001)", async () => {
    const fish = await othersFish();
    const res = await request(app).post(`/api/fish/${fish.id}/catch`);

    expect(res.status).toBe(401);
    expect(await catchRepo.listByCatcher("user-oid-123")).toHaveLength(0);
  });

  it("위조(다른 키 서명) 토큰은 401 로 거부한다 (NFR-SEC-001)", async () => {
    const fish = await othersFish();
    const other = await createKeyMaterial();
    const forged = await makeToken(other.privateKey);

    const res = await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(await catchRepo.listByCatcher("user-oid-123")).toHaveLength(0);
  });

  it("스냅샷은 원본 삭제 후에도 수집함에 생존한다 (REQ-SNAP-002, REQ-SNAP-003)", async () => {
    const fish = await othersFish();
    const token = await makeToken(privateKey);

    // A 가 B 의 물고기를 낚는다.
    await request(app)
      .post(`/api/fish/${fish.id}/catch`)
      .set("Authorization", `Bearer ${token}`);

    // 원본 소유자가 어항에서 삭제(저장소에서 원본 제거).
    await fishRepo.delete(fish.id);
    expect(await fishRepo.findById(fish.id)).toBeNull();

    // 수집 스냅샷은 그대로 조회·렌더링된다.
    const res = await request(app)
      .get("/api/me/catches")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].drawing).toEqual(validDrawing());
    expect(res.body[0].sourceFishId).toBe(fish.id);
  });
});

describe("GET /api/me/catches (수집함 조회)", () => {
  let privateKey;
  let verify;
  let fishRepo;
  let catchRepo;
  let app;

  beforeAll(async () => {
    const { privateKey: pk, jwks } = await createKeyMaterial();
    privateKey = pk;
    verify = (token) =>
      verifyTeamsToken(token, {
        jwks,
        audience: TEST_AUDIENCE,
        issuer: TEST_ISSUER,
      });
  });

  beforeEach(() => {
    fishRepo = new InMemoryFishRepository();
    catchRepo = new InMemoryCatchRepository();
    app = createApp({
      verify,
      fishRepository: fishRepo,
      catchRepository: catchRepo,
    });
  });

  it("인증된 본인이 낚은 물고기만 스냅샷으로 반환한다 (REQ-COLL-001, REQ-COLL-003, REQ-PRIV-003)", async () => {
    await catchRepo.create({
      catcherId: "user-oid-123",
      sourceFishId: "f1",
      drawing: validDrawing(),
      displayMode: "named",
      displayName: "내가낚은1",
    });
    await catchRepo.create({
      catcherId: "user-oid-123",
      sourceFishId: "f2",
      drawing: validDrawing(),
      displayMode: "anonymous",
      displayName: null,
    });
    // 타인의 수집(다른 catcher)은 포함되면 안 된다.
    await catchRepo.create({
      catcherId: "other-user",
      sourceFishId: "f3",
      drawing: validDrawing(),
      displayMode: "named",
      displayName: "남이낚은",
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/me/catches")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((c) => c.sourceFishId !== "f3")).toBe(true);
  });

  it("각 항목에 낚은 시각(caughtAt) 메타데이터를 포함한다 (REQ-COLL-004)", async () => {
    await catchRepo.create({
      catcherId: "user-oid-123",
      sourceFishId: "f1",
      drawing: validDrawing(),
      displayMode: "named",
      displayName: "내가낚은",
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/me/catches")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body[0].caughtAt).toBeTypeOf("string");
    expect(Number.isNaN(Date.parse(res.body[0].caughtAt))).toBe(false);
  });

  it("낚은 게 없으면 빈 배열을 반환한다 (REQ-COLL-005)", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/me/catches")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("수집함 응답에 원본 내부 owner_id 를 노출하지 않는다 (REQ-PRIV-004)", async () => {
    await catchRepo.create({
      catcherId: "user-oid-123",
      sourceFishId: "f1",
      drawing: validDrawing(),
      displayMode: "anonymous",
      displayName: null,
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/me/catches")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.every((c) => !("ownerId" in c))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("someone-else");
  });

  it("사용자는 타인의 수집함을 조회할 수 없다 — 본인 스코프 강제 (REQ-PRIV-003, NFR-SEC-003)", async () => {
    // 타인만 수집을 갖고 있다.
    await catchRepo.create({
      catcherId: "victim-user",
      sourceFishId: "f1",
      drawing: validDrawing(),
      displayMode: "named",
      displayName: "피해자수집",
    });

    // 요청자(user-oid-123)는 아무 것도 낚지 않았으므로 빈 목록만 받는다.
    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/me/catches")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("피해자수집");
  });

  it("토큰이 없으면 401 로 수집함 조회를 거부한다 (NFR-SEC-001)", async () => {
    const res = await request(app).get("/api/me/catches");
    expect(res.status).toBe(401);
  });
});
