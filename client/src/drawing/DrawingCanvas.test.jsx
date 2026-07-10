import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DrawingCanvas from "./DrawingCanvas.jsx";

// 래스터 페인트 캔버스 컴포넌트. 포인터로 픽셀에 그리고, 페인트통·이미지 업로드·지우개·
// undo/clear 를 제공한다. 커버: REQ-FILL-*, REQ-UPLOAD-*, REQ-ANIM-004, REQ-COMPAT-003.
// jsdom 은 2D 컨텍스트/픽셀을 지원하지 않으므로 DOM·상호작용·전파 형태만 검증한다.

describe("DrawingCanvas — 렌더링/컨트롤", () => {
  it("접근 가능한 캔버스와 모든 도구 버튼을 렌더링한다", () => {
    render(<DrawingCanvas />);
    expect(screen.getByLabelText("물고기 그리기 캔버스")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "페인트통" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지우개" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "실행 취소" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "초기화" })).toBeInTheDocument();
    expect(screen.getByLabelText("꼬리 위치")).toBeInTheDocument();
    expect(screen.getByLabelText("입 위치")).toBeInTheDocument();
  });

  it("이미지 업로드 입력이 허용 포맷(accept)을 지정한다 (REQ-UPLOAD-002)", () => {
    render(<DrawingCanvas />);
    const upload = screen.getByLabelText("이미지 올리기");
    expect(upload).toHaveAttribute("type", "file");
    expect(upload).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
  });
});

describe("DrawingCanvas — onChange (version 2 래스터)", () => {
  it("마운트 시 version 2 래스터 그림을 전파한다 (REQ-COMPAT-003)", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);
    expect(onChange).toHaveBeenCalled();
    const d = onChange.mock.calls.at(-1)[0];
    expect(d.version).toBe(2);
    expect(d.kind).toBe("raster");
    expect(d.width).toBe(300);
    expect(d.height).toBe(200);
    expect(typeof d.image).toBe("string");
  });

  it("포인터로 그리면 onChange 를 다시 호출하고 비어있지 않음을 알린다", () => {
    const onChange = vi.fn();
    const onEmptyChange = vi.fn();
    render(
      <DrawingCanvas
        width={300}
        height={200}
        onChange={onChange}
        onEmptyChange={onEmptyChange}
      />,
    );
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");

    expect(onEmptyChange).toHaveBeenLastCalledWith(true); // 초기엔 빈 캔버스

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 60 });

    const d = onChange.mock.calls.at(-1)[0];
    expect(d.version).toBe(2);
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);
  });

  it("초기화 버튼은 다시 빈 상태로 알린다", () => {
    const onEmptyChange = vi.fn();
    render(<DrawingCanvas onEmptyChange={onEmptyChange} />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(canvas, { clientX: 10, clientY: 10 });
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "초기화" }));
    expect(onEmptyChange).toHaveBeenLastCalledWith(true);
  });
});

describe("DrawingCanvas — 도구 토글", () => {
  it("페인트통 버튼은 눌림 상태(aria-pressed)를 토글한다", () => {
    render(<DrawingCanvas />);
    const bucket = screen.getByRole("button", { name: "페인트통" });
    expect(bucket).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bucket);
    expect(bucket).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(bucket);
    expect(bucket).toHaveAttribute("aria-pressed", "false");
  });

  it("지우개와 페인트통은 상호 배타적으로 선택된다", () => {
    render(<DrawingCanvas />);
    const bucket = screen.getByRole("button", { name: "페인트통" });
    const eraser = screen.getByRole("button", { name: "지우개" });
    fireEvent.click(eraser);
    expect(eraser).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(bucket);
    expect(bucket).toHaveAttribute("aria-pressed", "true");
    expect(eraser).toHaveAttribute("aria-pressed", "false");
  });
});

describe("DrawingCanvas — 가이드 슬라이더 (REQ-ANIM-004)", () => {
  it("꼬리 위치 슬라이더로 tailFraction 을 조정한다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("꼬리 위치"), { target: { value: "20" } });
    const d = onChange.mock.calls.at(-1)[0];
    expect(d.tailFraction).toBeCloseTo(0.2);
  });

  it("입 위치 슬라이더로 mouthFraction 을 조정한다", () => {
    const onChange = vi.fn();
    render(<DrawingCanvas width={300} height={200} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("입 위치"), { target: { value: "83" } });
    const d = onChange.mock.calls.at(-1)[0];
    expect(d.mouthFraction).toBeCloseTo(0.83);
  });
});
