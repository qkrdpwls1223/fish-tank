import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import MyTank from "./MyTank.jsx";
import { nextScale, SCALE_MAX, SCALE_MIN } from "./scale.js";

// "내 어항"(개인 전용) 뷰. 모든 API 를 주입해 네트워크 없이 검증한다. 캔버스 2D/rAF 는
// jsdom 에서 no-op 이라 렌더 픽셀이 아니라 접근성 대체 수단(목록/버튼/방향키)을 검증한다.

const DRAWING = { version: 1, width: 100, height: 60, strokes: [] };

function fish(id, extra = {}) {
  return {
    id,
    drawing: DRAWING,
    displayMode: "named",
    displayName: `물고기-${id}`,
    x: 100,
    y: 100,
    createdAt: "2026-07-10T00:00:00.000Z",
    ...extra,
  };
}
function decorItem(id, kind, extra = {}) {
  return { id, kind, x: 50, y: 50, createdAt: "2026-07-10T00:00:00.000Z", ...extra };
}

// 모든 API 를 통과시키는 기본 스텁 묶음(테스트별로 필요한 것만 덮어쓴다).
function deps(overrides = {}) {
  return {
    loadMyTank: vi.fn().mockResolvedValue({ fish: [], decor: [] }),
    moveFish: vi.fn().mockResolvedValue({}),
    deleteFish: vi.fn().mockResolvedValue(undefined),
    createDecor: vi.fn().mockResolvedValue(decorItem("d-new", "seaweed")),
    moveDecor: vi.fn().mockResolvedValue({}),
    deleteDecor: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("MyTank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("진입 시 내 어항을 로드해 물고기와 장식을 목록에 렌더링한다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({
        fish: [fish("a")],
        decor: [decorItem("d1", "rock")],
      }),
    });
    render(<MyTank token="t" {...d} />);

    // 물고기와 장식이 배치 목록에 나타난다(선택 버튼의 정확한 접근성 이름으로 조회).
    expect(
      await screen.findByRole("button", { name: "물고기-a의 물고기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "장식 · 바위" })).toBeInTheDocument();
    await waitFor(() =>
      expect(d.loadMyTank).toHaveBeenCalledWith({ token: "t" }),
    );
  });

  it("비어 있으면 안내 문구를 보여준다", async () => {
    render(<MyTank token="t" {...deps()} />);
    expect(
      await screen.findByText(/아직 비어 있어요/),
    ).toBeInTheDocument();
  });

  it("조회 실패 시 오류 안내를 보여준다", async () => {
    const d = deps({ loadMyTank: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<MyTank token="t" {...d} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/불러오지 못했어요/);
  });

  it("장식 팔레트로 수초를 넣으면 POST 하고 목록에 추가된다", async () => {
    const created = decorItem("d-seaweed", "seaweed", { x: 120, y: 220 });
    const d = deps({ createDecor: vi.fn().mockResolvedValue(created) });
    render(<MyTank token="tok-1" {...d} />);

    // 빈 상태에서 팔레트 버튼이 노출된다.
    const addSeaweed = await screen.findByRole("button", { name: "수초 넣기" });
    fireEvent.click(addSeaweed);

    await waitFor(() =>
      expect(d.createDecor).toHaveBeenCalledWith({
        token: "tok-1",
        kind: "seaweed",
        x: 120,
        y: 220,
      }),
    );
    // 서버가 준 장식이 목록에 나타난다.
    expect(
      await screen.findByRole("button", { name: "장식 · 수초" }),
    ).toBeInTheDocument();
  });

  it("항목의 삭제 버튼을 누르면 DELETE 를 호출하고 목록에서 사라진다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({ fish: [], decor: [decorItem("d1", "castle")] }),
    });
    render(<MyTank token="tok-2" {...d} />);

    const del = await screen.findByRole("button", { name: "성 삭제" });
    fireEvent.click(del);

    await waitFor(() =>
      expect(d.deleteDecor).toHaveBeenCalledWith({ token: "tok-2", id: "d1" }),
    );
    expect(screen.queryByRole("button", { name: "성 삭제" })).toBeNull();
  });

  it("물고기를 선택하고 방향키로 옮기면 새 좌표로 PATCH 한다(접근성 이동)", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({ fish: [fish("a")], decor: [] }),
    });
    render(<MyTank token="tok-3" {...d} />);

    const item = await screen.findByRole("button", { name: "물고기-a의 물고기" });
    fireEvent.click(item); // 선택
    fireEvent.keyDown(item, { key: "ArrowRight" });

    // x 는 12px 증가(NUDGE_STEP), y 는 유지.
    await waitFor(() =>
      expect(d.moveFish).toHaveBeenCalledWith({
        token: "tok-3",
        id: "a",
        x: 112,
        y: 100,
      }),
    );
  });

  it("장식을 캔버스에서 드래그하면 드롭 위치로 PATCH 한다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({ fish: [], decor: [decorItem("d1", "rock")] }),
    });
    render(<MyTank token="tok-4" {...d} />);

    await screen.findByRole("button", { name: "장식 · 바위" });
    const canvas = screen.getByLabelText("내 어항 캔버스");
    // 장식은 (50,50). jsdom getBoundingClientRect 는 0 을 주므로 clientX/Y 가 곧 어항 좌표다.
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 120, pointerId: 1 });

    await waitFor(() =>
      expect(d.moveDecor).toHaveBeenCalledWith({
        token: "tok-4",
        id: "d1",
        x: 90,
        y: 120,
      }),
    );
  });

  it("선택하기 전에는 크게/작게 버튼이 없고, 선택하면 나타난다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({ fish: [fish("a")], decor: [] }),
    });
    render(<MyTank token="t" {...d} />);

    const item = await screen.findByRole("button", { name: "물고기-a의 물고기" });
    // 선택 전: 크기 버튼 없음.
    expect(screen.queryByRole("button", { name: "물고기-a의 물고기 크게" })).toBeNull();

    fireEvent.click(item); // 선택

    expect(
      await screen.findByRole("button", { name: "물고기-a의 물고기 크게" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "물고기-a의 물고기 작게" }),
    ).toBeInTheDocument();
  });

  it("선택한 물고기의 '크게'를 누르면 늘어난 scale 로 PATCH 하고 안내한다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({ fish: [fish("a", { scale: 1 })], decor: [] }),
    });
    render(<MyTank token="tok-5" {...d} />);

    const item = await screen.findByRole("button", { name: "물고기-a의 물고기" });
    fireEvent.click(item);
    fireEvent.click(await screen.findByRole("button", { name: "물고기-a의 물고기 크게" }));

    // 렌더/저장에 도달하는 값은 순수 헬퍼가 정하는 값과 같다(1.0 → 1.2, 클램프됨).
    await waitFor(() =>
      expect(d.moveFish).toHaveBeenCalledWith({
        token: "tok-5",
        id: "a",
        x: 100,
        y: 100,
        scale: nextScale(1, 1),
      }),
    );
    expect(nextScale(1, 1)).toBe(1.2);
    expect(await screen.findByText("크게 했어요.")).toBeInTheDocument();
  });

  it("연속으로 '크게'를 누르면 scale 이 누적되어 더 커진다(리렌더 반영)", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({ fish: [fish("a", { scale: 1 })], decor: [] }),
    });
    render(<MyTank token="tok-6" {...d} />);

    const item = await screen.findByRole("button", { name: "물고기-a의 물고기" });
    fireEvent.click(item);
    const grow = await screen.findByRole("button", { name: "물고기-a의 물고기 크게" });
    fireEvent.click(grow); // 1.0 → 1.2
    await waitFor(() => expect(d.moveFish).toHaveBeenCalledTimes(1));
    fireEvent.click(grow); // 1.2 → 1.4 (리렌더된 item.scale 기준)
    await waitFor(() => expect(d.moveFish).toHaveBeenCalledTimes(2));

    expect(d.moveFish.mock.calls[1][0].scale).toBe(1.4);
  });

  it("'작게'를 누르면 줄어든 scale 로 PATCH 한다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({
        fish: [],
        decor: [decorItem("d1", "rock", { scale: 1 })],
      }),
    });
    render(<MyTank token="tok-7" {...d} />);

    const item = await screen.findByRole("button", { name: "장식 · 바위" });
    fireEvent.click(item);
    fireEvent.click(await screen.findByRole("button", { name: "바위 작게" }));

    await waitFor(() =>
      expect(d.moveDecor).toHaveBeenCalledWith({
        token: "tok-7",
        id: "d1",
        x: 50,
        y: 50,
        scale: nextScale(1, -1),
      }),
    );
    expect(nextScale(1, -1)).toBe(0.8);
  });

  it("최대 크기에서는 '크게'가, 최소 크기에서는 '작게'가 비활성화된다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({
        fish: [fish("big", { scale: SCALE_MAX }), fish("small", { scale: SCALE_MIN })],
        decor: [],
      }),
    });
    render(<MyTank token="t" {...d} />);

    // 최대 크기 물고기 선택 → 크게 비활성화, 작게 활성화.
    fireEvent.click(await screen.findByRole("button", { name: "물고기-big의 물고기" }));
    expect(
      await screen.findByRole("button", { name: "물고기-big의 물고기 크게" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "물고기-big의 물고기 작게" }),
    ).toBeEnabled();

    // 최소 크기 물고기 선택 → 작게 비활성화, 크게 활성화.
    fireEvent.click(screen.getByRole("button", { name: "물고기-small의 물고기" }));
    expect(
      await screen.findByRole("button", { name: "물고기-small의 물고기 작게" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "물고기-small의 물고기 크게" }),
    ).toBeEnabled();
  });

  it("익명 물고기는 소유자 신원 대신 '익명'으로 표시한다", async () => {
    const d = deps({
      loadMyTank: vi.fn().mockResolvedValue({
        fish: [fish("x", { displayMode: "anonymous", displayName: null })],
        decor: [],
      }),
    });
    render(<MyTank token="t" {...d} />);

    expect(
      await screen.findByRole("button", { name: "익명의 물고기" }),
    ).toBeInTheDocument();
  });
});
