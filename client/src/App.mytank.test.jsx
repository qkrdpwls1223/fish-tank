import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

// 3탭 전환(공유 어항 / 내 수집함 / 내 어항)과 그리기 라우팅.
// authenticate/tankProps/myTankProps/createMyTankFish/submitFish 를 주입해 네트워크 없이 검증한다.

function authOk() {
  return vi
    .fn()
    .mockResolvedValue({ userId: "u1", displayName: "홍길동", token: "tok-abc" });
}
function tankDeps() {
  return {
    loadSnapshot: vi.fn().mockResolvedValue([]),
    connect: vi.fn(() => ({ close: vi.fn() })),
  };
}
function myTankDeps() {
  return { loadMyTank: vi.fn().mockResolvedValue({ fish: [], decor: [] }) };
}

// 그리기 캔버스에 유효한 물고기를 그리는 헬퍼(FishComposer 테스트와 동일 패턴).
function drawFish() {
  const canvas = screen.getByLabelText("물고기 그리기 캔버스");
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { clientX: 120, clientY: 90 });
  fireEvent.pointerUp(canvas, { clientX: 120, clientY: 90 });
}

describe("App — 내 어항 탭 (3탭 전환)", () => {
  it("'내 어항' 버튼을 누르면 내 어항 뷰로 전환한다", async () => {
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        myTankProps={myTankDeps()}
      />,
    );

    await screen.findByLabelText("어항"); // 기본 공유 어항
    await userEvent.click(screen.getByRole("button", { name: "내 어항" }));

    // 내 어항 캔버스가 나타나고 공유 어항은 언마운트된다.
    expect(await screen.findByLabelText("내 어항 캔버스")).toBeInTheDocument();
    expect(screen.queryByLabelText("어항")).toBeNull();
  });

  it("내 어항 뷰에서도 '물고기 그리기' 버튼이 노출된다", async () => {
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        myTankProps={myTankDeps()}
      />,
    );

    await screen.findByLabelText("어항");
    await userEvent.click(screen.getByRole("button", { name: "내 어항" }));
    await screen.findByLabelText("내 어항 캔버스");

    expect(
      screen.getByRole("button", { name: /물고기 그리기/ }),
    ).toBeEnabled();
  });

  it("내 어항 뷰에서 그린 물고기는 my-tank 로만 저장되고 공유 어항으로는 가지 않는다", async () => {
    const createMyTankFish = vi.fn().mockResolvedValue({ id: "mf-1" });
    const submitFish = vi.fn().mockResolvedValue({ id: "shared-x" }); // 공유 경로(호출되면 안 됨)
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        myTankProps={myTankDeps()}
        createMyTankFish={createMyTankFish}
        submitFish={submitFish}
      />,
    );

    await screen.findByLabelText("어항");
    await userEvent.click(screen.getByRole("button", { name: "내 어항" }));
    await screen.findByLabelText("내 어항 캔버스");

    // 그리기 모달 열기 → 그림 → 제출.
    fireEvent.click(screen.getByRole("button", { name: /물고기 그리기/ }));
    await screen.findByLabelText("물고기 그리기 캔버스");
    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    // my-tank 경로로 기본 위치(x,y)와 함께 저장된다.
    await waitFor(() => expect(createMyTankFish).toHaveBeenCalledTimes(1));
    const arg = createMyTankFish.mock.calls[0][0];
    expect(arg.token).toBe("tok-abc");
    expect(arg.displayMode).toBe("named");
    expect(arg.x).toBe(300);
    expect(arg.y).toBe(180);
    // 신규 물고기는 래스터(version 2)로 저장된다(REQ-COMPAT-003).
    expect(arg.drawing.version).toBe(2);
    expect(arg.drawing.kind).toBe("raster");
    // 공유 어항 경로는 절대 호출되지 않는다(프라이버시 불변식).
    expect(submitFish).not.toHaveBeenCalled();
  });

  it("공유 어항 뷰에서 그린 물고기는 공유 경로로 가고 my-tank 로는 가지 않는다", async () => {
    const createMyTankFish = vi.fn().mockResolvedValue({ id: "mf-1" });
    const submitFish = vi.fn().mockResolvedValue({ id: "shared-x" });
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        myTankProps={myTankDeps()}
        createMyTankFish={createMyTankFish}
        submitFish={submitFish}
      />,
    );

    await screen.findByLabelText("어항"); // 공유 어항(기본 뷰)

    fireEvent.click(screen.getByRole("button", { name: /물고기 그리기/ }));
    await screen.findByLabelText("물고기 그리기 캔버스");
    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    await waitFor(() => expect(submitFish).toHaveBeenCalledTimes(1));
    expect(createMyTankFish).not.toHaveBeenCalled();
  });
});
