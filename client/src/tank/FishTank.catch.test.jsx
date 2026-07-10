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

// 기본 낚싯대 던지기 버튼은 어항 중앙(기본 800x450 → 400,225)으로 던진다.
const CENTER = { x: 400, y: 225 };

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
    await renderGame({ positions: [{ id: "a", x: CENTER.x, y: CENTER.y }] });

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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
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
      positions: [{ id: "a", x: CENTER.x, y: CENTER.y }],
    });

    fireEvent.click(castBtn());
    await advanceToStrike();
    fireEvent.click(reelBtn());
    await advance(0);

    expect(send).not.toHaveBeenCalled();
  });

  it("건짐/도망 연출 후 찌가 걷히고 다시 던질 수 있다 (idle 복귀)", async () => {
    await renderGame({ positions: [{ id: "a", x: CENTER.x, y: CENTER.y }] });

    fireEvent.click(castBtn());
    await advanceToStrike();
    await advance(BITE_WINDOW_MS + 200); // 도망
    expect(castBtn()).toBeDisabled(); // 연출 중

    await advance(1600); // CLEAR 지연 경과 → idle 복귀
    expect(castBtn()).toBeEnabled();
  });

  it("캔버스 클릭으로 조준해 던질 수 있다(마우스 향상 경로) — 클릭 지점 물고기가 입질한다", async () => {
    const { catchFish } = await renderGame({
      // 클릭 조준 지점(300,150)에 물고기를 둔다. jsdom getBoundingClientRect 는 0 이므로 client 좌표 그대로.
      positions: [{ id: "z", x: 300, y: 150 }],
    });

    fireEvent.click(screen.getByLabelText("어항"), { clientX: 300, clientY: 150 });
    await advanceToStrike();

    expect(reelBtn()).toBeEnabled();
    fireEvent.click(reelBtn());
    await advance(0);
    expect(catchFish).toHaveBeenCalledWith({ token: "tok-abc", id: "z" });
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
