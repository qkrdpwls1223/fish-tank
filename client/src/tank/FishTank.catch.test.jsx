import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FishTank from "./FishTank.jsx";
import { BITE_WINDOW_MS } from "./fishingGame.js";

// 실시간 낚시 미니게임 (SPEC-CATCH-001: REQ-CATCH-001/003/004/005, REQ-PRIV-002, NFR-A11Y-001).
// 캔버스 위에서 낚싯대를 던지고(찌 투척) → 물고기가 찌 근처로 오면 입질 → 타이밍 창 안에
// 건져올리면 잡히고, 놓치면 미끼만 먹고 도망친다. 낚아도 원본은 어항에 그대로 남는다(비파괴).
//
// 입질 판정용 물고기 위치는 getSpritePositions prop 으로 결정적으로 주입한다(캔버스/rAF 무관).
// 게임 루프/타이머는 setInterval + Date 기반이라 가짜 타이머로 결정적으로 구동한다.
// 상호작용은 fireEvent(동기)로 한다 — React18 + 가짜 타이머 + userEvent 조합은 교착에 빠진다.

// 던지기는 배(낚시꾼) 바로 아래로 수직 낙하한다. 배 기본 위치 = width - ROD_TIP_MARGIN_RIGHT(=46),
// 기본 800x450 에서는 x=754. 던지기 y 는 어항 중앙 깊이(height/2=225). 입질 대상은 이 지점에 둔다.
const UNDER_BOAT = { x: 754, y: 225 };
// 방향키 한 번에 배가 움직이는 거리(FishTank BOAT_KEY_STEP 와 동일).
const BOAT_KEY_STEP = 28;

function fish(id, extra = {}) {
  return {
    id,
    drawing: { version: 1, width: 100, height: 60, strokes: [] },
    displayMode: "named",
    displayName: `물고기-${id}`,
    createdAt: "2026-07-09T00:00:00.000Z",
    ...extra,
  };
}

function fakeConnect() {
  const captured = {};
  const send = vi.fn();
  const connect = vi.fn((opts) => {
    Object.assign(captured, opts);
    return { close: vi.fn(), send };
  });
  return { connect, captured, send };
}

let originalRaf;
let originalCaf;

beforeEach(() => {
  // rAF(캔버스 그리기/물리) 루프는 이 테스트에 불필요하고, 가짜 타이머 + 자기재예약 rAF 는
  // 비동기 타이머 진행을 무한 루프시킨다. rAF 를 비활성화하면 컴포넌트가 그리기 루프를 건너뛴다.
  originalRaf = globalThis.requestAnimationFrame;
  originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = undefined;
  globalThis.cancelAnimationFrame = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
});

// 가짜 타이머를 진행시키며 그 사이 마이크로태스크(프라미스 resolve)도 flush 한다(act 로 감싸 경고 방지).
async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

// 캐스트 직후: 찌 착수(CAST_ARC_MS≈500) → 예신(NIBBLE_MS≈500) → 본신(strike)까지 넉넉히 진행.
// 본신에 들어가야 건져올리기가 활성화된다(챔질 창은 이후 2초).
// 여러 번에 나눠 진행해야 각 단계 전이(cast→nibble→strike) 사이에 리렌더로 gameRef 가 갱신된다
// — 한 번의 advanceTimersByTime 안에서는 리렌더가 지연돼 다단계 전이가 진행되지 않는다.
async function advanceToStrike() {
  for (let i = 0; i < 8; i += 1) await advance(200);
}

// 렌더 + 초기 스냅샷 로드 flush. getSpritePositions 로 입질 대상 위치를 주입한다.
// rng 기본값 () => 0 은 입질 확률(BITE_CHANCE) 굴림을 항상 성공시켜 결정적으로 입질을 만든다.
async function renderGame({ fishList = [], positions = [], catchImpl, rng } = {}) {
  const { connect, send } = fakeConnect();
  const loadSnapshot = vi.fn().mockResolvedValue(fishList);
  const catchFish =
    catchImpl ??
    vi.fn().mockResolvedValue({ id: "catch-1", alreadyCollected: false });
  render(
    <FishTank
      token="tok-abc"
      fishing
      loadSnapshot={loadSnapshot}
      connect={connect}
      catchFish={catchFish}
      getSpritePositions={() => positions}
      rng={rng ?? (() => 0)}
    />,
  );
  await advance(0); // 초기 resync(스냅샷) flush
  return { catchFish, send };
}

const castBtn = () => screen.getByRole("button", { name: "낚싯대 던지기" });
const reelBtn = () => screen.getByRole("button", { name: "건져올리기" });
const region = () => screen.getByRole("status", { name: "낚시 안내" });

describe("FishTank 낚시 미니게임 (SPEC-CATCH-001)", () => {
  it("낚싯대 던지기 버튼을 누르면 찌를 던지고 안내한다 — 던지기는 비활성, 건져올리기는 아직 비활성", async () => {
    await renderGame();
    expect(castBtn()).toBeEnabled();
    expect(reelBtn()).toBeDisabled();

    fireEvent.click(castBtn());
    await advance(0);

    // 찌를 던진 뒤에는 던지기 비활성(찌는 한 번에 하나), 입질 전이라 건져올리기도 비활성.
    expect(castBtn()).toBeDisabled();
    expect(reelBtn()).toBeDisabled();
    expect(region()).toHaveTextContent("낚싯대를 던졌어요");
    expect(region()).toHaveAttribute("aria-live");
  });

  it("입질은 예신(톡톡) → 본신(쑥) 2단계로 오고, 본신에서만 건져올리기가 활성화된다 (REQ-CATCH-001, NFR-A11Y-001)", async () => {
    await renderGame({ positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }] });

    fireEvent.click(castBtn());

    // 착수 후 예신(nibble) 단계: 아직 본신이 아니라 챔질 불가.
    await advance(700);
    expect(region()).toHaveTextContent("톡톡");
    expect(reelBtn()).toBeDisabled();

    // 예신 시간이 지나면 본신(strike)으로 찌가 쑥 들어가고 챔질 창이 열린다.
    await advance(700);
    expect(region()).toHaveTextContent("쑥 들어갔어요");
    expect(reelBtn()).toBeEnabled();
  });

  it("확률 굴림에 실패하면 물고기가 그냥 스쳐 지나가 입질이 오지 않고, 같은 물고기를 매 틱 재굴림하지 않는다 (BITE_CHANCE)", async () => {
    // rng=0.99 는 BITE_CHANCE(0.5) 굴림을 항상 실패시킨다 → 입질 없음.
    await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
      rng: () => 0.99,
    });

    fireEvent.click(castBtn());
    // 여러 틱을 흘려보내도(물고기가 계속 반경 안에 있어도) 재굴림 없이 입질이 오지 않는다.
    await advance(1000);

    expect(reelBtn()).toBeDisabled();
    expect(region()).toHaveTextContent("입질을 기다려요");
  });

  it("입질 중 건져올리기를 누르면 catchFish 를 토큰과 입질 물고기 id 로 호출하고 성공을 안내한다 (NFR-SEC-001)", async () => {
    const { catchFish } = await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike(); // 입질 발생
    fireEvent.click(reelBtn());
    await advance(0); // catchFish 응답 flush

    expect(catchFish).toHaveBeenCalledWith({ token: "tok-abc", id: "a" });
    expect(region()).toHaveTextContent("잡았다! 수집함에 담겼어요");
  });

  it("이미 수집한 물고기(alreadyCollected)면 '이미 수집함에 있어요'로 안내한다 (REQ-CATCH-005)", async () => {
    await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
      catchImpl: vi.fn().mockResolvedValue({ id: "c", alreadyCollected: true }),
    });

    fireEvent.click(castBtn());
    await advanceToStrike();
    fireEvent.click(reelBtn());
    await advance(0);

    expect(region()).toHaveTextContent("이미 수집함에 있어요");
  });

  it("원본이 사라진 물고기(404 not_found)면 '물고기가 사라졌어요'로 안내한다 (REQ-CATCH-004)", async () => {
    const err = new Error("gone");
    err.code = "not_found";
    await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
      catchImpl: vi.fn().mockRejectedValue(err),
    });

    fireEvent.click(castBtn());
    await advanceToStrike();
    fireEvent.click(reelBtn());
    await advance(0);

    expect(region()).toHaveTextContent("물고기가 사라졌어요");
  });

  it("타이밍 창을 놓치면 미끼만 먹고 도망가고 catchFish 는 호출되지 않는다 (미끼만 먹고 튐)", async () => {
    const { catchFish } = await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike(); // 입질 발생
    expect(reelBtn()).toBeEnabled();

    // 건져올리지 않고 입질 창을 넘긴다 → 도망.
    await advance(BITE_WINDOW_MS + 200);

    expect(catchFish).not.toHaveBeenCalled();
    expect(region()).toHaveTextContent("미끼만 먹고 도망갔어요");
    // 도망 후에는 건져올리기가 다시 비활성이다(입질 아님).
    expect(reelBtn()).toBeDisabled();
  });

  it("낚아도(건짐) 원본 물고기는 어항 목록에 그대로 남는다 — 비파괴 (REQ-CATCH-003)", async () => {
    await renderGame({
      fishList: [fish("a"), fish("b")],
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike();
    fireEvent.click(reelBtn());
    await advance(0);

    // 목록을 열어 원본이 어항에 그대로 헤엄치는지 확인.
    fireEvent.click(screen.getByRole("button", { name: /목록 열기/ }));
    const list = screen.getByRole("list");
    expect(within(list).getByText("물고기-a")).toBeInTheDocument();
    expect(within(list).getByText("물고기-b")).toBeInTheDocument();
  });

  it("도망 뒤에도 원본 물고기는 어항 목록에 그대로 남는다 — 비파괴 (REQ-CATCH-003)", async () => {
    await renderGame({
      fishList: [fish("a")],
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike();
    await advance(BITE_WINDOW_MS + 200); // 도망

    fireEvent.click(screen.getByRole("button", { name: /목록 열기/ }));
    const list = screen.getByRole("list");
    expect(within(list).getByText("물고기-a")).toBeInTheDocument();
  });

  it("낚시는 실시간 채널로 어떤 이벤트도 보내지 않는다 — 브로드캐스트 없음 (REQ-PRIV-002)", async () => {
    const { send } = await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike();
    fireEvent.click(reelBtn());
    await advance(0);

    expect(send).not.toHaveBeenCalled();
  });

  it("건짐/도망 연출 후 찌가 걷히고 다시 던질 수 있다 (idle 복귀)", async () => {
    await renderGame({ positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }] });

    fireEvent.click(castBtn());
    await advanceToStrike();
    await advance(BITE_WINDOW_MS + 200); // 도망
    expect(castBtn()).toBeDisabled(); // 연출 중

    await advance(1600); // CLEAR 지연 경과 → idle 복귀
    expect(castBtn()).toBeEnabled();
  });

  it("캔버스 클릭은 더 이상 던지지 않는다 — 조준 제거(수직 캐스트 전환)", async () => {
    await renderGame({ positions: [{ id: "z", x: 300, y: 150 }] });

    // 예전 클릭 조준 경로. 이제는 아무 일도 일어나지 않아 던지기 버튼이 계속 활성이어야 한다.
    fireEvent.click(screen.getByLabelText("어항"), { clientX: 300, clientY: 150 });
    await advance(0);

    expect(castBtn()).toBeEnabled();
    // 던지지 않았으므로 안내 라이브 영역 자체가 아직 렌더되지 않는다(문구 없음).
    expect(screen.queryByRole("status", { name: "낚시 안내" })).toBeNull();
  });

  it("스페이스바로 던지고, 본신에서 스페이스바로 즉시 챔질한다 (NFR-A11Y-001)", async () => {
    const { catchFish } = await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    // 대기(idle) 중 스페이스바 → 던지기.
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await advance(0);
    expect(castBtn()).toBeDisabled(); // 던져져서 비활성
    expect(region()).toHaveTextContent("낚싯대를 던졌어요");

    await advanceToStrike(); // 입질(본신)까지 진행
    expect(reelBtn()).toBeEnabled();

    // 본신 중 스페이스바 → 즉시 챔질.
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await advance(0);
    expect(catchFish).toHaveBeenCalledWith({ token: "tok-abc", id: "a" });
    expect(region()).toHaveTextContent("잡았다! 수집함에 담겼어요");
  });

  it("입력 요소(input)에 포커스면 스페이스바를 무시한다(게임 조작 가로채지 않음)", async () => {
    await renderGame();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: " ", code: "Space" });
    await advance(0);

    // 입력 중이므로 던지기가 발생하지 않아 버튼은 여전히 활성.
    expect(castBtn()).toBeEnabled();
    document.body.removeChild(input);
  });

  it("예신 단계에서 스페이스바는 헛챔질(무시)이라 도망시키지 않는다 — 본신에서만 챔질", async () => {
    await renderGame({ positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }] });

    fireEvent.click(castBtn());
    await advance(700); // 예신(nibble) 단계 진입(본신 전)
    expect(region()).toHaveTextContent("톡톡");

    // 예신 중 스페이스바 → 아무 일도 일어나지 않는다(본신 전이라 챔질 불가).
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await advance(0);
    expect(region()).toHaveTextContent("톡톡"); // 여전히 예신

    // 그대로 본신으로 진행되면 챔질 가능해진다.
    await advance(700);
    expect(reelBtn()).toBeEnabled();
  });

  it("반경 안에 머무는 물고기도 상시 재굴림으로 결국 입질한다 — 던져놓고 무반응 방지", async () => {
    // 초반 굴림(진입/첫 재굴림)은 모두 실패시키고, 이후 재굴림에서 성공하게 한다.
    let n = 0;
    await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
      rng: () => (n++ < 2 ? 0.99 : 0),
    });

    fireEvent.click(castBtn());

    // 재굴림 주기를 여러 번 흘려보내면 체류 물고기가 결국 입질(본신)까지 온다.
    let enabled = false;
    for (let i = 0; i < 25 && !enabled; i += 1) {
      await advance(200);
      enabled = !reelBtn().disabled;
    }
    expect(enabled).toBe(true); // 상시 입질로 본신 도달 → 건져올리기 활성
  });

  it("fishing 미지정(공유 어항 감상 모드)이면 낚시 UI가 전혀 노출되지 않는다", async () => {
    const { connect } = fakeConnect();
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    render(
      <FishTank
        token="tok-abc"
        loadSnapshot={loadSnapshot}
        connect={connect}
        getSpritePositions={() => []}
      />,
    );
    await advance(0); // 초기 resync flush

    // 낚싯대 던지기/건져올리기 버튼과 낚시 안내 영역이 모두 없어야 한다(순수 감상 화면).
    expect(
      screen.queryByRole("button", { name: "낚싯대 던지기" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "건져올리기" })).toBeNull();
    expect(screen.queryByRole("status", { name: "낚시 안내" })).toBeNull();
    // 어항 캔버스 자체는 감상 모드에서도 그대로 렌더된다.
    expect(screen.getByLabelText("어항")).toBeInTheDocument();
  });

  it("낚시 모드에서는 수면에 배+낚시꾼 장식 레이어가 렌더된다 (낚싯줄이 손끝에서 나오는 연출)", async () => {
    await renderGame();
    const boat = screen.getByTestId("fishing-boat");
    expect(boat).toBeInTheDocument();
    // 순수 장식이므로 스크린리더에는 숨긴다.
    expect(boat).toHaveAttribute("aria-hidden", "true");
  });

  it("공유 어항(fishing 미지정)에서는 배+낚시꾼 레이어가 존재하지 않는다 — 낚시 탭 전용", async () => {
    const { connect } = fakeConnect();
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    render(
      <FishTank
        token="tok-abc"
        loadSnapshot={loadSnapshot}
        connect={connect}
        getSpritePositions={() => []}
      />,
    );
    await advance(0);
    expect(screen.queryByTestId("fishing-boat")).toBeNull();
  });

  it("본신 중 스페이스가 한 틱에 겹쳐 들어와도 catchFish 는 한 번만 호출된다 — 이중 챔질 방지", async () => {
    const { catchFish } = await renderGame({
      positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike(); // 본신(챔질 창) 진입
    expect(reelBtn()).toBeEnabled();

    // 리렌더로 phase 가 CAUGHT 로 갱신되기 전에 스페이스 두 번이 같은 act(한 틱) 안에서 겹쳐 들어오는
    // 오토리핏/연타 상황을 재현한다. 동기 가드가 없으면 두 번 모두 phase===BITING 으로 보여 이중 호출된다.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space" }));
    });
    await advance(0); // catchFish 응답 flush

    expect(catchFish).toHaveBeenCalledTimes(1);
    expect(catchFish).toHaveBeenCalledWith({ token: "tok-abc", id: "a" });
  });
});

// 배 좌우 이동 + 수직 캐스트 (방향키/드래그로 배를 옮기고, 던지면 배 바로 아래로 수직 낙하).
describe("FishTank 낚시 배 이동 + 수직 캐스트", () => {
  // 배 드래그 히트영역의 style.left = effectiveBoatX - 20. 이 좌표로 배 x 변화를 관찰한다.
  const boatLeft = () => parseFloat(screen.getByTestId("boat-drag-handle").style.left);

  it("방향키 ←/→ 로 배 x 가 바뀌고, 좌우 경계에서 clamp 된다", async () => {
    await renderGame();
    // 기본 위치: effectiveBoatX = 754 → 핸들 left = 734.
    expect(boatLeft()).toBe(734);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(boatLeft()).toBe(734 - BOAT_KEY_STEP); // 좌로 한 칸

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(boatLeft()).toBe(734); // 다시 우로 한 칸(원위치)

    // 오른쪽으로 계속 눌러도 기본 위치(=최대, width - ROD_TIP_MARGIN_RIGHT=754)를 넘지 않는다.
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(boatLeft()).toBe(734);

    // 왼쪽으로 계속 눌러도 최소 경계(BOAT_EDGE_MARGIN_LEFT=16)에서 멈춘다 → 핸들 left = -4.
    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(boatLeft()).toBe(16 - 20);
  });

  it("A/D 키로도 배가 좌우로 움직인다(대소문자 무관)", async () => {
    await renderGame();
    expect(boatLeft()).toBe(734); // 기본 위치

    fireEvent.keyDown(window, { key: "a" }); // 좌로 한 칸
    expect(boatLeft()).toBe(734 - BOAT_KEY_STEP);

    fireEvent.keyDown(window, { key: "D" }); // 대문자도 우로 한 칸
    expect(boatLeft()).toBe(734);
  });

  it("던지면 찌가 배 x 바로 아래로 수직 낙하한다 — 배를 옮긴 위치의 물고기가 입질한다", async () => {
    // 배를 왼쪽으로 3칸(=84px) 옮긴 위치(754-84=670)에만 물고기를 둔다.
    const { catchFish } = await renderGame({
      positions: [{ id: "a", x: 754 - 3 * BOAT_KEY_STEP, y: 225 }],
    });

    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(window, { key: "ArrowLeft" });

    // 방향키로 옮긴 뒤 스페이스로 던진다(수직 캐스트) → 옮긴 위치 물고기가 입질해야 한다.
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await advanceToStrike();
    expect(reelBtn()).toBeEnabled();

    // 본신에서 스페이스로 챔질 → 옮긴 위치의 물고기 id 로 잡힌다(캐스트 x = 배 x 임을 확인).
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await advance(0);
    expect(catchFish).toHaveBeenCalledWith({ token: "tok-abc", id: "a" });
  });

  it("찌가 나가 있는 동안(IDLE 아님)에는 배 이동을 잠근다 — 방향키/드래그 모두 무시", async () => {
    await renderGame({ positions: [{ id: "a", x: UNDER_BOAT.x, y: UNDER_BOAT.y }] });

    fireEvent.click(castBtn()); // 던짐 → phase 가 IDLE 이 아니게 된다
    const before = boatLeft();

    // 던진 상태에서 방향키는 배를 움직이지 않는다.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(boatLeft()).toBe(before);

    // 드래그 히트영역도 잠겨 포인터 이벤트를 받지 않는다.
    expect(screen.getByTestId("boat-drag-handle").style.pointerEvents).toBe("none");
  });
});

// 키보드 조작은 실제 타이머 + userEvent 로 검증한다(가짜 타이머와 userEvent 는 교착).
describe("FishTank 낚시 키보드 접근성 (NFR-A11Y-001)", () => {
  it("낚싯대 던지기 버튼은 키보드(Enter)로 조작할 수 있다", async () => {
    vi.useRealTimers(); // userEvent 는 실제 타이머 필요(가짜 타이머와 교착)
    const { connect } = fakeConnect();
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    render(
      <FishTank
        token="t"
        fishing
        loadSnapshot={loadSnapshot}
        connect={connect}
        catchFish={vi.fn().mockResolvedValue({ alreadyCollected: false })}
        getSpritePositions={() => []}
      />,
    );

    const btn = await screen.findByRole("button", { name: "낚싯대 던지기" });
    btn.focus();
    expect(btn).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(btn).toBeDisabled(); // 던져져서 비활성
    expect(
      await screen.findByRole("status", { name: "낚시 안내" }),
    ).toHaveTextContent("낚싯대를 던졌어요");
  });
});
