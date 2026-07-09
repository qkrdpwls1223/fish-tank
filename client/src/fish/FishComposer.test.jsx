import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FishComposer from "./FishComposer.jsx";

// 물고기 등록 UI. 드로잉 + 이름/익명 선택 + 사전 검증 + 인증 게이트 제출.
// 커버: REQ-DRAW-001/004/005, REQ-AUTH-003, NFR-SEC-003, NFR-SEC-001(토큰 제출).

const authed = { status: "authenticated", identity: { displayName: "홍길동" } };
const unauthed = { status: "error", identity: null };

// 캔버스에 유효한 물고기를 그리는 헬퍼(포인터 시퀀스).
function drawFish() {
  const canvas = screen.getByLabelText("물고기 그리기 캔버스");
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { clientX: 120, clientY: 90 });
  fireEvent.pointerUp(canvas, { clientX: 120, clientY: 90 });
}

describe("FishComposer — 렌더링/게이트", () => {
  it("캔버스와 이름/익명 선택, 제출 버튼을 렌더링한다 (REQ-AUTH-003)", () => {
    render(<FishComposer authState={authed} token="t" submitFish={vi.fn()} />);
    expect(screen.getByLabelText("물고기 그리기 캔버스")).toBeInTheDocument();
    expect(screen.getByLabelText("이름 표시")).toBeInTheDocument();
    expect(screen.getByLabelText("익명")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "어항에 풀어놓기" }),
    ).toBeInTheDocument();
  });

  it("인증되지 않으면 제출 버튼을 비활성화한다 (REQ-AUTH-004)", () => {
    render(
      <FishComposer authState={unauthed} token={null} submitFish={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "어항에 풀어놓기" }),
    ).toBeDisabled();
  });
});

describe("FishComposer — 사전 검증 (REQ-DRAW-004)", () => {
  it("빈 그림으로 제출하면 사유를 안내하고 API 를 호출하지 않는다", async () => {
    const submitFish = vi.fn();
    render(
      <FishComposer authState={authed} token="t" submitFish={submitFish} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/그림/);
    expect(submitFish).not.toHaveBeenCalled();
  });
});

describe("FishComposer — 제출 (REQ-AUTH-003, NFR-SEC-001)", () => {
  it("유효한 그림을 이름 모드로 토큰과 함께 제출한다", async () => {
    const submitFish = vi.fn(async () => ({ id: "fish-1" }));
    render(
      <FishComposer authState={authed} token="tok-9" submitFish={submitFish} />,
    );

    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    await waitFor(() => expect(submitFish).toHaveBeenCalledTimes(1));
    const arg = submitFish.mock.calls[0][0];
    expect(arg.token).toBe("tok-9");
    expect(arg.displayMode).toBe("named");
    expect(arg.drawing.strokes).toHaveLength(1);
  });

  it("등록에 성공하면 onSuccess 를 호출한다(모달 닫기)", async () => {
    const submitFish = vi.fn(async () => ({ id: "fish-1" }));
    const onSuccess = vi.fn();
    render(
      <FishComposer
        authState={authed}
        token="t"
        submitFish={submitFish}
        onSuccess={onSuccess}
      />,
    );

    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("검증 실패나 서버 오류 시에는 onSuccess 를 호출하지 않는다", async () => {
    const submitFish = vi.fn(async () => {
      throw Object.assign(new Error("fail"), { reason: "too_large" });
    });
    const onSuccess = vi.fn();
    render(
      <FishComposer
        authState={authed}
        token="t"
        submitFish={submitFish}
        onSuccess={onSuccess}
      />,
    );

    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("익명을 선택하면 displayMode 를 anonymous 로 제출한다", async () => {
    const submitFish = vi.fn(async () => ({ id: "fish-2" }));
    render(
      <FishComposer authState={authed} token="t" submitFish={submitFish} />,
    );

    fireEvent.click(screen.getByLabelText("익명"));
    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    await waitFor(() => expect(submitFish).toHaveBeenCalledTimes(1));
    expect(submitFish.mock.calls[0][0].displayMode).toBe("anonymous");
  });

  it("서버 오류 시 사유를 사용자에게 안내한다", async () => {
    const err = Object.assign(new Error("fail"), {
      code: "invalid_drawing",
      reason: "too_large",
    });
    const submitFish = vi.fn(async () => {
      throw err;
    });
    render(
      <FishComposer authState={authed} token="t" submitFish={submitFish} />,
    );

    drawFish();
    fireEvent.click(screen.getByRole("button", { name: "어항에 풀어놓기" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
