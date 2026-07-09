import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { verifyTeamsToken } from "../auth/verifyTeamsToken.js";
import { InMemoryFishRepository } from "../fish/fishRepository.js";
import { InMemoryBroadcaster } from "../realtime/broadcaster.js";
import {
  createKeyMaterial,
  makeToken,
  TEST_ISSUER,
  TEST_AUDIENCE,
} from "../../test/helpers/tokens.js";

// POST /api/fish 통합 테스트.
// 커버: REQ-DRAW-003, REQ-AUTH-003, REQ-OWN-001, REQ-OWN-004,
//       REQ-PERSIST-001, NFR-SEC-001, NFR-SEC-002, NFR-SEC-003.

// 유효한 스트로크 그림(테스트 헬퍼).
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

describe("POST /api/fish", () => {
  let privateKey;
  let verify;
  let repo;
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
    repo = new InMemoryFishRepository();
    app = createApp({ verify, fishRepository: repo });
  });

  it("유효한 토큰+그림으로 이름 물고기를 생성하면 201 과 공개 필드를 반환한다", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "named" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("string");
    expect(res.body.displayMode).toBe("named");
    expect(res.body.displayName).toBe("홍길동"); // 검증된 토큰의 이름 사용
    expect(res.body.drawing).toEqual(validDrawing());
    expect(res.body.createdAt).toBeTypeOf("string");
  });

  it("생성 응답은 생성자에게 deletable:true 로 내려간다 (REQ-OWN-002, ownerId 미노출)", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "anonymous" });

    expect(res.status).toBe(201);
    expect(res.body.deletable).toBe(true);
    expect("ownerId" in res.body).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("user-oid-123");
  });

  it("생성된 물고기는 DB(저장소)에 영구 저장된다 (REQ-PERSIST-001)", async () => {
    const token = await makeToken(privateKey);
    await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "named" });

    const all = await repo.list();
    expect(all).toHaveLength(1);
  });

  it("공개 응답에 내부 ownerId 를 절대 노출하지 않는다 (REQ-OWN-004)", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "named" });

    expect("ownerId" in res.body).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("user-oid-123");
  });

  it("익명 물고기도 내부적으로 인증된 소유자 ID 를 저장한다 (REQ-OWN-001)", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "anonymous" });

    expect(res.status).toBe(201);
    expect(res.body.displayMode).toBe("anonymous");
    expect(res.body.displayName).toBeNull();
    expect("ownerId" in res.body).toBe(false);

    const [stored] = await repo.list();
    expect(stored.ownerId).toBe("user-oid-123"); // 토큰 oid
  });

  it("이름 물고기의 표시 이름은 클라이언트 body 가 아니라 검증된 토큰에서 온다 (NFR-SEC-002)", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({
        drawing: validDrawing(),
        displayMode: "named",
        displayName: "조작된이름",
      });

    expect(res.body.displayName).toBe("홍길동");
  });

  it("클라이언트가 보낸 ownerId 는 무시하고 인증 신원을 소유자로 저장한다 (NFR-SEC-002)", async () => {
    const token = await makeToken(privateKey);
    await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({
        drawing: validDrawing(),
        displayMode: "named",
        ownerId: "victim-999",
      });

    const [stored] = await repo.list();
    expect(stored.ownerId).toBe("user-oid-123");
  });

  it("토큰이 없으면 401 이며 아무것도 저장하지 않는다 (NFR-SEC-001)", async () => {
    const res = await request(app)
      .post("/api/fish")
      .send({ drawing: validDrawing(), displayMode: "named" });

    expect(res.status).toBe(401);
    expect(await repo.list()).toHaveLength(0);
  });

  it("위조(다른 키 서명) 토큰은 401 로 거부한다 (NFR-SEC-001/002)", async () => {
    const other = await createKeyMaterial();
    const forged = await makeToken(other.privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${forged}`)
      .send({ drawing: validDrawing(), displayMode: "named" });

    expect(res.status).toBe(401);
    expect(await repo.list()).toHaveLength(0);
  });

  it("빈/무효 그림은 400 과 사유를 반환하고 저장하지 않는다 (REQ-DRAW-004)", async () => {
    const token = await makeToken(privateKey);
    const empty = { version: 1, width: 300, height: 200, strokes: [] };
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: empty, displayMode: "named" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_drawing");
    expect(res.body.error.reason).toBe("empty");
    expect(await repo.list()).toHaveLength(0);
  });

  it("주입 시도(악성 색상) 그림은 400 으로 거부한다 (NFR-SEC-003)", async () => {
    const token = await makeToken(privateKey);
    const malicious = validDrawing();
    malicious.strokes[0].color = "javascript:alert(1)";
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: malicious, displayMode: "named" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_drawing");
    expect(res.body.error.reason).toBe("invalid_format");
  });

  it("displayMode 가 named/anonymous 가 아니면 400 으로 거부한다 (REQ-AUTH-003)", async () => {
    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "public" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_display_mode");
    expect(await repo.list()).toHaveLength(0);
  });
});

// GET /api/fish — 진입 시 전체 스냅샷 로드 (REQ-RT-004).
describe("GET /api/fish (스냅샷)", () => {
  let privateKey;
  let verify;
  let repo;
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
    repo = new InMemoryFishRepository();
    app = createApp({ verify, fishRepository: repo });
  });

  it("저장된 모든 물고기를 공개 형식으로 반환한다 (REQ-RT-004)", async () => {
    await repo.create({
      drawing: validDrawing(),
      ownerId: "owner-a",
      displayMode: "named",
      displayName: "가나다",
    });
    await repo.create({
      drawing: validDrawing(),
      ownerId: "owner-b",
      displayMode: "anonymous",
      displayName: null,
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].displayName).toBe("가나다");
    expect(res.body[1].displayMode).toBe("anonymous");
  });

  it("스냅샷 응답에 내부 ownerId 를 절대 노출하지 않는다 (REQ-OWN-004)", async () => {
    await repo.create({
      drawing: validDrawing(),
      ownerId: "secret-owner-777",
      displayMode: "anonymous",
      displayName: null,
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("secret-owner-777");
    expect(res.body.every((f) => !("ownerId" in f))).toBe(true);
  });

  it("스냅샷은 요청 사용자 기준 deletable 플래그를 계산해 붙인다 (REQ-OWN-002/004)", async () => {
    // 요청자(토큰 oid) 소유 물고기 + 타인 소유 물고기.
    const mine = await repo.create({
      drawing: validDrawing(),
      ownerId: "user-oid-123", // makeToken 의 oid
      displayMode: "named",
      displayName: "내물고기",
    });
    const theirs = await repo.create({
      drawing: validDrawing(),
      ownerId: "other-owner",
      displayMode: "named",
      displayName: "남물고기",
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((f) => [f.id, f]));
    expect(byId[mine.id].deletable).toBe(true);
    expect(byId[theirs.id].deletable).toBe(false);
    // deletable 을 계산해도 ownerId 는 절대 노출하지 않는다.
    expect(res.body.every((f) => !("ownerId" in f))).toBe(true);
  });

  it("본인 익명 물고기는 스냅샷에서 deletable:true 이며 신원은 미노출 (REQ-OWN-001/004)", async () => {
    const myAnon = await repo.create({
      drawing: validDrawing(),
      ownerId: "user-oid-123",
      displayMode: "anonymous",
      displayName: null,
    });

    const token = await makeToken(privateKey);
    const res = await request(app)
      .get("/api/fish")
      .set("Authorization", `Bearer ${token}`);

    const view = res.body.find((f) => f.id === myAnon.id);
    expect(view.deletable).toBe(true);
    expect(view.displayMode).toBe("anonymous");
    expect(view.displayName).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("user-oid-123");
  });

  it("토큰이 없으면 401 로 스냅샷을 거부한다 (NFR-SEC-001)", async () => {
    const res = await request(app).get("/api/fish");
    expect(res.status).toBe(401);
  });
});

// DELETE /api/fish/:id — 삭제 및 소유권 규칙 (M4).
// 커버: REQ-OWN-002(본인 삭제), REQ-OWN-003(타인 거부), NFR-SEC-002(서버측 소유권 경계),
//       REQ-RT-002(삭제 실시간 전파).
describe("DELETE /api/fish/:id", () => {
  let privateKey;
  let verify;
  let repo;
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
    repo = new InMemoryFishRepository();
    broadcaster = new InMemoryBroadcaster();
    app = createApp({ verify, fishRepository: repo, broadcaster });
  });

  // 요청자(토큰 oid) 소유 물고기를 저장한다.
  async function myFish(displayMode = "named") {
    return repo.create({
      drawing: validDrawing(),
      ownerId: "user-oid-123",
      displayMode,
      displayName: displayMode === "named" ? "내물고기" : null,
    });
  }

  it("본인이 만든 이름 물고기를 삭제하면 저장소에서 제거된다 (REQ-OWN-002)", async () => {
    const fish = await myFish("named");
    const token = await makeToken(privateKey);

    const res = await request(app)
      .delete(`/api/fish/${fish.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect([200, 204]).toContain(res.status);
    expect(await repo.findById(fish.id)).toBeNull();
  });

  it("본인이 만든 익명 물고기도 삭제할 수 있다 (REQ-OWN-002, REQ-OWN-001)", async () => {
    const fish = await myFish("anonymous");
    const token = await makeToken(privateKey);

    const res = await request(app)
      .delete(`/api/fish/${fish.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect([200, 204]).toContain(res.status);
    expect(await repo.findById(fish.id)).toBeNull();
  });

  it("삭제 성공 시 fish_deleted 이벤트를 id 만 담아 브로드캐스트한다 (REQ-RT-002)", async () => {
    const fish = await myFish("named");
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    await request(app)
      .delete(`/api/fish/${fish.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe("fish_deleted");
    expect(event.id).toBe(fish.id);
    // 삭제 이벤트에도 내부 소유자 신원이 새어나가면 안 된다.
    expect(JSON.stringify(event)).not.toContain("user-oid-123");
  });

  it("타인이 만든 물고기 삭제는 403 으로 거부하고 유지한다 (REQ-OWN-003, NFR-SEC-002)", async () => {
    const others = await repo.create({
      drawing: validDrawing(),
      ownerId: "someone-else-999",
      displayMode: "named",
      displayName: "남물고기",
    });
    const token = await makeToken(privateKey); // oid = user-oid-123

    const res = await request(app)
      .delete(`/api/fish/${others.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    // 물고기는 그대로 유지된다.
    expect(await repo.findById(others.id)).not.toBeNull();
    // 403 응답이 소유자 신원을 노출하면 안 된다 (REQ-OWN-004).
    expect(JSON.stringify(res.body)).not.toContain("someone-else-999");
    expect("ownerId" in (res.body ?? {})).toBe(false);
  });

  it("타인 물고기 삭제 거부 시 브로드캐스트하지 않는다 (NFR-SEC-002)", async () => {
    const others = await repo.create({
      drawing: validDrawing(),
      ownerId: "someone-else-999",
      displayMode: "anonymous",
      displayName: null,
    });
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    await request(app)
      .delete(`/api/fish/${others.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(listener).not.toHaveBeenCalled();
  });

  it("존재하지 않는 물고기 삭제는 404 이며 브로드캐스트하지 않는다", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    const res = await request(app)
      .delete(`/api/fish/does-not-exist`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(listener).not.toHaveBeenCalled();
  });

  it("토큰이 없으면 401 이며 삭제하지 않는다 (NFR-SEC-001)", async () => {
    const fish = await myFish("named");
    const res = await request(app).delete(`/api/fish/${fish.id}`);

    expect(res.status).toBe(401);
    expect(await repo.findById(fish.id)).not.toBeNull();
  });

  it("위조(다른 키 서명) 토큰은 401 로 거부한다 (NFR-SEC-001/002)", async () => {
    const fish = await myFish("named");
    const other = await createKeyMaterial();
    const forged = await makeToken(other.privateKey);

    const res = await request(app)
      .delete(`/api/fish/${fish.id}`)
      .set("Authorization", `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(await repo.findById(fish.id)).not.toBeNull();
  });

  it("클라이언트가 body 로 위조 소유권을 주장해도 서버는 토큰 신원으로만 검증한다 (NFR-SEC-002)", async () => {
    const others = await repo.create({
      drawing: validDrawing(),
      ownerId: "victim-owner",
      displayMode: "named",
      displayName: "피해자물고기",
    });
    const token = await makeToken(privateKey); // oid = user-oid-123

    // 공격자가 자신을 소유자라고 body 로 주장.
    const res = await request(app)
      .delete(`/api/fish/${others.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ownerId: "user-oid-123" });

    expect(res.status).toBe(403);
    expect(await repo.findById(others.id)).not.toBeNull();
  });
});

// POST /api/fish 생성 시 실시간 fish_added 브로드캐스트 (REQ-RT-001).
describe("POST /api/fish 실시간 브로드캐스트", () => {
  let privateKey;
  let verify;
  let repo;
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
    repo = new InMemoryFishRepository();
    broadcaster = new InMemoryBroadcaster();
    app = createApp({ verify, fishRepository: repo, broadcaster });
  });

  it("물고기 생성 시 fish_added 이벤트를 브로드캐스트한다 (REQ-RT-001)", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const token = await makeToken(privateKey);
    const res = await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "named" });

    expect(res.status).toBe(201);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe("fish_added");
    expect(event.fish.id).toBe(res.body.id);
  });

  it("브로드캐스트 이벤트에도 내부 ownerId 를 노출하지 않는다 (REQ-OWN-004)", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const token = await makeToken(privateKey);
    await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: validDrawing(), displayMode: "anonymous" });

    const event = listener.mock.calls[0][0];
    expect("ownerId" in event.fish).toBe(false);
    expect(JSON.stringify(event)).not.toContain("user-oid-123");
  });

  it("검증 실패(무효 그림) 시에는 브로드캐스트하지 않는다", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const token = await makeToken(privateKey);
    const empty = { version: 1, width: 300, height: 200, strokes: [] };
    await request(app)
      .post("/api/fish")
      .set("Authorization", `Bearer ${token}`)
      .send({ drawing: empty, displayMode: "named" });

    expect(listener).not.toHaveBeenCalled();
  });
});

// POST /api/feed — 먹이주기 실시간 공유 (REQ-INT-001, REQ-INT-003).
// 커버: 인증 필요(NFR-SEC-001), 좌표만 브로드캐스트하고 소유자 신원 비노출(REQ-OWN-004).
describe("POST /api/feed (먹이주기 실시간 공유)", () => {
  let privateKey;
  let verify;
  let repo;
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
    repo = new InMemoryFishRepository();
    broadcaster = new InMemoryBroadcaster();
    app = createApp({ verify, fishRepository: repo, broadcaster });
  });

  it("인증된 사용자의 먹이주기는 food_dropped 이벤트로 좌표를 브로드캐스트한다 (REQ-INT-003)", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    const res = await request(app)
      .post("/api/feed")
      .set("Authorization", `Bearer ${token}`)
      .send({ x: 320, y: 240 });

    expect(res.status).toBe(200);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.type).toBe("food_dropped");
    expect(event.food).toEqual({ x: 320, y: 240 });
  });

  it("먹이 이벤트에 소유자 신원(userId 등)을 절대 노출하지 않는다 (REQ-OWN-004, REQ-INT-003)", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    await request(app)
      .post("/api/feed")
      .set("Authorization", `Bearer ${token}`)
      .send({ x: 10, y: 20 });

    const event = listener.mock.calls[0][0];
    expect("ownerId" in event.food).toBe(false);
    expect(JSON.stringify(event)).not.toContain("user-oid-123");
  });

  it("좌표가 숫자가 아니면 400 으로 거부하고 브로드캐스트하지 않는다", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);
    const token = await makeToken(privateKey);

    const res = await request(app)
      .post("/api/feed")
      .set("Authorization", `Bearer ${token}`)
      .send({ x: "left", y: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_food");
    expect(listener).not.toHaveBeenCalled();
  });

  it("토큰이 없으면 401 이며 브로드캐스트하지 않는다 (NFR-SEC-001)", async () => {
    const listener = vi.fn();
    broadcaster.subscribe(listener);

    const res = await request(app).post("/api/feed").send({ x: 1, y: 2 });

    expect(res.status).toBe(401);
    expect(listener).not.toHaveBeenCalled();
  });
});
