import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { verifyTeamsToken } from "../auth/verifyTeamsToken.js";
import { InMemoryFishRepository } from "../fish/fishRepository.js";
import { InMemoryCatchRepository } from "../catch/catchRepository.js";
import { InMemoryMyTankRepository } from "../mytank/myTankRepository.js";
import { InMemoryBroadcaster } from "../realtime/broadcaster.js";
import {
  createKeyMaterial,
  makeToken,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from "../../test/helpers/tokens.js";

// 내 어항(개인 어항) 통합 테스트.
// 불변식: 프라이버시/스코프(타인 행 접근 불가), 공유 어항 격리(브로드캐스트 없음),
//   owner_id 비노출, 그림 검증 재사용, 장식 종류 화이트리스트.

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

describe("내 어항 라우트 (/api/my-tank)", () => {
  let privateKey;
  let verify;
  let fishRepo;
  let catchRepo;
  let myTankRepo;
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
    myTankRepo = new InMemoryMyTankRepository();
    broadcaster = new InMemoryBroadcaster();
    app = createApp({
      verify,
      fishRepository: fishRepo,
      catchRepository: catchRepo,
      myTankRepository: myTankRepo,
      broadcaster,
    });
  });

  // 사용자 A(oid=user-oid-123, name=홍길동), 사용자 B(oid=user-B-999).
  const tokenA = () => makeToken(privateKey);
  const tokenB = () =>
    makeToken(privateKey, { claims: { oid: "user-B-999", name: "유저비" } });

  async function addFish(token, body = {}) {
    return request(app)
      .post("/api/my-tank/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "named", x: 10, y: 20, ...body });
  }
  async function addDecor(token, body = {}) {
    return request(app)
      .post("/api/my-tank/decor")
      .set("Authorization", `Bearer ${token}`)
      .send({ kind: "seaweed", x: 5, y: 6, ...body });
  }

  // ---- GET /api/my-tank ----

  it("GET /api/my-tank 는 호출자 본인의 물고기와 장식만 반환한다", async () => {
    const a = await tokenA();
    await addFish(a);
    await addDecor(a, { kind: "rock" });

    const res = await request(app)
      .get("/api/my-tank")
      .set("Authorization", `Bearer ${a}`);

    expect(res.status).toBe(200);
    expect(res.body.fish).toHaveLength(1);
    expect(res.body.decor).toHaveLength(1);
    expect(res.body.decor[0].kind).toBe("rock");
  });

  it("GET /api/my-tank 는 타인의 물고기/장식을 절대 노출하지 않는다 (스코프)", async () => {
    const a = await tokenA();
    const b = await tokenB();
    await addFish(a);
    await addDecor(a);

    const res = await request(app)
      .get("/api/my-tank")
      .set("Authorization", `Bearer ${b}`);

    expect(res.status).toBe(200);
    expect(res.body.fish).toEqual([]);
    expect(res.body.decor).toEqual([]);
  });

  it("응답에는 어떤 경우에도 owner_id/ownerId 가 포함되지 않는다", async () => {
    const a = await tokenA();
    await addFish(a);
    await addDecor(a);
    const res = await request(app)
      .get("/api/my-tank")
      .set("Authorization", `Bearer ${a}`);

    expect(res.body.fish.every((f) => !("ownerId" in f))).toBe(true);
    expect(res.body.decor.every((d) => !("ownerId" in d))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("user-oid-123");
  });

  it("토큰이 없으면 401 로 조회를 거부한다 (NFR-SEC-001)", async () => {
    const res = await request(app).get("/api/my-tank");
    expect(res.status).toBe(401);
  });

  // ---- POST /api/my-tank/fish ----

  it("물고기를 그려 넣으면 201 과 공개 물고기(좌표 포함)를 반환한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { x: 111, y: 222 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("string");
    expect(res.body.drawing).toEqual(validDrawing());
    expect(res.body.x).toBe(111);
    expect(res.body.y).toBe(222);
    expect("ownerId" in res.body).toBe(false);
  });

  it("named 물고기의 displayName 은 클라이언트 값이 아니라 토큰 신원에서 유도한다 (NFR-SEC-002)", async () => {
    const a = await tokenA();
    const res = await addFish(a, { displayMode: "named", displayName: "조작된이름" });
    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe("홍길동");
  });

  it("anonymous 물고기는 displayName 을 노출하지 않는다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { displayMode: "anonymous", displayName: "조작된이름" });
    expect(res.status).toBe(201);
    expect(res.body.displayMode).toBe("anonymous");
    expect(res.body.displayName).toBeNull();
  });

  it("잘못된 displayMode 는 400 으로 거부한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { displayMode: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_display_mode");
  });

  it("유효하지 않은 그림은 400 으로 거부한다 (validateDrawing 재사용)", async () => {
    const a = await tokenA();
    const res = await addFish(a, { drawing: { version: 1, width: 9, height: 9, strokes: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_drawing");
  });

  it("좌표가 숫자가 아니면 400 으로 거부한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { x: "left", y: null });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_position");
  });

  // ---- scale (물고기) ----

  it("scale 을 지정해 물고기를 생성하면 그 값을 반환한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { scale: 2.25 });
    expect(res.status).toBe(201);
    expect(res.body.scale).toBe(2.25);
  });

  it("scale 을 생략하면 기본값 1.0 으로 생성한다", async () => {
    const a = await tokenA();
    const res = await addFish(a);
    expect(res.status).toBe(201);
    expect(res.body.scale).toBe(1.0);
  });

  it("scale 이 하한(0.3) 미만이면 400 invalid_scale 로 거부한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { scale: 0.1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_scale");
  });

  it("scale 이 상한(3.0) 초과면 400 invalid_scale 로 거부한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { scale: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_scale");
  });

  it("scale 이 숫자가 아니면 400 invalid_scale 로 거부한다", async () => {
    const a = await tokenA();
    const res = await addFish(a, { scale: "big" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_scale");
  });

  it("GET /api/my-tank 응답의 물고기에는 scale 이 포함된다", async () => {
    const a = await tokenA();
    await addFish(a, { scale: 1.75 });
    const res = await request(app).get("/api/my-tank").set("Authorization", `Bearer ${a}`);
    expect(res.body.fish[0].scale).toBe(1.75);
  });

  // ---- 공유 어항 격리 ----

  it("내 어항 물고기는 공유 어항(GET /api/fish)에 나타나지 않는다 (프라이버시)", async () => {
    const a = await tokenA();
    await addFish(a);

    const shared = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${a}`);
    expect(shared.status).toBe(200);
    expect(shared.body).toEqual([]);
  });

  it("내 어항 물고기 생성은 브로드캐스터를 절대 호출하지 않는다 (프라이버시)", async () => {
    const a = await tokenA();
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    await addFish(a);
    await addDecor(a);
    expect(listener).not.toHaveBeenCalled();
  });

  // ---- PATCH /api/my-tank/fish/:id ----

  it("PATCH 로 본인 물고기 위치를 이동한다", async () => {
    const a = await tokenA();
    const created = await addFish(a, { x: 1, y: 1 });
    const res = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 300, y: 400 });

    expect(res.status).toBe(200);
    expect(res.body.x).toBe(300);
    expect(res.body.y).toBe(400);
    expect("ownerId" in res.body).toBe(false);
  });

  it("PATCH 로 타인 물고기를 이동하려 하면 404 이며 원본은 변경되지 않는다 (누출 없는 스코프)", async () => {
    const a = await tokenA();
    const b = await tokenB();
    const created = await addFish(a, { x: 1, y: 1 });

    const res = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${b}`)
      .send({ x: 999, y: 999 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
    // A 의 물고기는 그대로다.
    const mine = await request(app).get("/api/my-tank").set("Authorization", `Bearer ${a}`);
    expect(mine.body.fish[0].x).toBe(1);
    expect(mine.body.fish[0].y).toBe(1);
  });

  it("PATCH 좌표가 숫자가 아니면 400 으로 거부한다", async () => {
    const a = await tokenA();
    const created = await addFish(a);
    const res = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: "nope", y: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_position");
  });

  it("PATCH 로 본인 물고기의 scale 을 좌표와 함께 갱신한다", async () => {
    const a = await tokenA();
    const created = await addFish(a, { x: 1, y: 1, scale: 1.0 });
    const res = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 2, y: 3, scale: 2.0 });
    expect(res.status).toBe(200);
    expect(res.body.x).toBe(2);
    expect(res.body.scale).toBe(2.0);
  });

  it("PATCH 에 scale 을 생략하면 기존 scale 을 유지한다", async () => {
    const a = await tokenA();
    const created = await addFish(a, { x: 1, y: 1, scale: 2.5 });
    const res = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 9, y: 9 });
    expect(res.status).toBe(200);
    expect(res.body.scale).toBe(2.5);
  });

  it("PATCH 의 scale 이 범위를 벗어나면 400 invalid_scale 로 거부한다", async () => {
    const a = await tokenA();
    const created = await addFish(a);
    const below = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 1, y: 1, scale: 0.1 });
    expect(below.status).toBe(400);
    expect(below.body.error.code).toBe("invalid_scale");

    const above = await request(app)
      .patch(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 1, y: 1, scale: 9 });
    expect(above.status).toBe(400);
    expect(above.body.error.code).toBe("invalid_scale");
  });

  // ---- DELETE /api/my-tank/fish/:id ----

  it("DELETE 로 본인 물고기를 삭제한다", async () => {
    const a = await tokenA();
    const created = await addFish(a);
    const res = await request(app)
      .delete(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`);
    expect(res.status).toBe(204);
    const mine = await request(app).get("/api/my-tank").set("Authorization", `Bearer ${a}`);
    expect(mine.body.fish).toHaveLength(0);
  });

  it("DELETE 로 타인 물고기를 삭제하려 하면 404 이며 원본은 생존한다 (누출 없는 스코프)", async () => {
    const a = await tokenA();
    const b = await tokenB();
    const created = await addFish(a);

    const res = await request(app)
      .delete(`/api/my-tank/fish/${created.body.id}`)
      .set("Authorization", `Bearer ${b}`);
    expect(res.status).toBe(404);

    const mine = await request(app).get("/api/my-tank").set("Authorization", `Bearer ${a}`);
    expect(mine.body.fish).toHaveLength(1);
  });

  // ---- 장식 (decor) ----

  it("POST /api/my-tank/decor 는 허용된 종류를 201 로 생성한다", async () => {
    const a = await tokenA();
    for (const kind of ["seaweed", "rock", "castle"]) {
      const res = await addDecor(a, { kind });
      expect(res.status).toBe(201);
      expect(res.body.kind).toBe(kind);
      expect("ownerId" in res.body).toBe(false);
    }
  });

  it("허용되지 않은 장식 종류는 400 으로 거부한다 (화이트리스트)", async () => {
    const a = await tokenA();
    const res = await addDecor(a, { kind: "nuclear_reactor" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_kind");
  });

  it("장식 좌표가 숫자가 아니면 400 으로 거부한다", async () => {
    const a = await tokenA();
    const res = await addDecor(a, { x: "x", y: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_position");
  });

  it("scale 을 지정해 장식을 생성하고, 생략 시 기본값 1.0 을 반환한다", async () => {
    const a = await tokenA();
    const scaled = await addDecor(a, { scale: 0.5 });
    expect(scaled.status).toBe(201);
    expect(scaled.body.scale).toBe(0.5);
    const defaulted = await addDecor(a);
    expect(defaulted.body.scale).toBe(1.0);
  });

  it("장식 scale 이 범위를 벗어나면 400 invalid_scale 로 거부한다", async () => {
    const a = await tokenA();
    const below = await addDecor(a, { scale: 0.1 });
    expect(below.status).toBe(400);
    expect(below.body.error.code).toBe("invalid_scale");
    const above = await addDecor(a, { scale: 3.5 });
    expect(above.status).toBe(400);
    expect(above.body.error.code).toBe("invalid_scale");
  });

  it("GET /api/my-tank 응답의 장식에는 scale 이 포함된다", async () => {
    const a = await tokenA();
    await addDecor(a, { scale: 2.0 });
    const res = await request(app).get("/api/my-tank").set("Authorization", `Bearer ${a}`);
    expect(res.body.decor[0].scale).toBe(2.0);
  });

  it("장식 PATCH 좌표가 숫자가 아니면 400 으로 거부한다", async () => {
    const a = await tokenA();
    const created = await addDecor(a);
    const res = await request(app)
      .patch(`/api/my-tank/decor/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: "nope", y: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_position");
  });

  it("PATCH 로 본인 장식을 이동하고, 타인 장식은 404 를 반환한다 (스코프)", async () => {
    const a = await tokenA();
    const b = await tokenB();
    const created = await addDecor(a, { x: 1, y: 1 });

    const ok = await request(app)
      .patch(`/api/my-tank/decor/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 70, y: 80, scale: 1.5 });
    expect(ok.status).toBe(200);
    expect(ok.body.x).toBe(70);
    expect(ok.body.scale).toBe(1.5);

    const denied = await request(app)
      .patch(`/api/my-tank/decor/${created.body.id}`)
      .set("Authorization", `Bearer ${b}`)
      .send({ x: 0, y: 0 });
    expect(denied.status).toBe(404);
  });

  it("장식 PATCH 의 scale 이 범위를 벗어나면 400 invalid_scale 로 거부한다", async () => {
    const a = await tokenA();
    const created = await addDecor(a);
    const res = await request(app)
      .patch(`/api/my-tank/decor/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`)
      .send({ x: 1, y: 1, scale: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_scale");
  });

  it("DELETE 로 본인 장식을 삭제하고, 타인 장식은 404 를 반환한다 (스코프)", async () => {
    const a = await tokenA();
    const b = await tokenB();
    const created = await addDecor(a);

    const denied = await request(app)
      .delete(`/api/my-tank/decor/${created.body.id}`)
      .set("Authorization", `Bearer ${b}`);
    expect(denied.status).toBe(404);

    const ok = await request(app)
      .delete(`/api/my-tank/decor/${created.body.id}`)
      .set("Authorization", `Bearer ${a}`);
    expect(ok.status).toBe(204);

    const mine = await request(app).get("/api/my-tank").set("Authorization", `Bearer ${a}`);
    expect(mine.body.decor).toHaveLength(0);
  });

  it("위조(다른 키 서명) 토큰은 401 로 모든 내 어항 접근을 거부한다 (NFR-SEC-001)", async () => {
    const other = await createKeyMaterial();
    const forged = await makeToken(other.privateKey);
    const res = await request(app)
      .get("/api/my-tank")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});
