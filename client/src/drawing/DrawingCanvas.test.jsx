import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DrawingCanvas from "./DrawingCanvas.jsx";

// 자유 드로잉 캔버스 컴포넌트. 포인터(마우스/터치/펜) 입력으로 그린다.
// 커버: REQ-DRAW-001(자유 드로잉), REQ-DRAW-005(undo/clear).
// 캔버스 2D 렌더링은 jsdom 미지원이므로 로직/상호작용만 검증한다.

describe("DrawingCanvas", () => {
  it("접근 가능한 라벨을 가진 캔버스와 undo/clear 버튼을 렌더링한다", () => {
    render(<DrawingCanvas />);
    expect(screen.getByLabelText("물고기 그리기 캔버스")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "실행 취소" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초기화" })).toBeInTheDocument();
  });

  it("포인터로 그리면 onChange 에 스트로크가 담긴 그림을 전달한다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 60 });

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.version).toBe(1);
    expect(last.strokes).toHaveLength(1);
    expect(last.strokes[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it("초기화 버튼은 스트로크를 모두 지운다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas onChange={onChange} />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 60 });

    fireEvent.click(screen.getByRole("button", { name: "초기화" }));
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.strokes).toHaveLength(0);
  });

  it("실행 취소 버튼은 마지막 스트로크를 제거한다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas onChange={onChange} />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");

    // 첫 번째 스트로크
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 60 });
    // 두 번째 스트로크
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 150, clientY: 150 });

    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.strokes).toHaveLength(1);
  });

  it("꼬리 위치 슬라이더로 tailFraction 을 조정한다(캔버스와 분리)", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("꼬리 위치"), { target: { value: "20" } });

    const last = onChange.mock.calls.at(-1)[0];
    expect(last.tailFraction).toBeCloseTo(0.2);
    expect(last.strokes).toHaveLength(0); // 슬라이더 조정은 그리기가 아니다
  });

  it("입 위치 슬라이더로 mouthFraction 을 조정한다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("입 위치"), { target: { value: "83" } });

    const last = onChange.mock.calls.at(-1)[0];
    expect(last.mouthFraction).toBeCloseTo(0.83);
    expect(last.strokes).toHaveLength(0);
  });

  it("캔버스 포인터 입력은 이제 가이드와 무관하게 항상 그리기로만 동작한다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");

    // 예전 꼬리선 위치(x=120) 위에서 눌러도 드래그가 아니라 획이 그려져야 한다.
    fireEvent.pointerDown(canvas, { clientX: 120, clientY: 100 });
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 130 });
    fireEvent.pointerUp(canvas, { clientX: 160, clientY: 130 });

    const last = onChange.mock.calls.at(-1)[0];
    expect(last.strokes).toHaveLength(1);
  });
});
