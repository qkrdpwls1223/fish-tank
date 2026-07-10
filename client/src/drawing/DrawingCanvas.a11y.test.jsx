import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DrawingCanvas from "./DrawingCanvas.jsx";

// 접근성 (NFR-A11Y-001): 래스터 페인트 캔버스의 대체 안내 + 도구 컨트롤 키보드 조작성.
// 캔버스는 포인터 전용이므로, 대체 안내 문구와 접근 가능한 도구 컨트롤을 제공한다.
// 페인트통·이미지 업로드 경로에도 접근성 대체 수단(라벨/안내)을 갖춘다.

describe("DrawingCanvas 접근성 (NFR-A11Y-001)", () => {
  it("캔버스에 접근성 설명(aria-describedby)이 연결되어 있다", () => {
    render(<DrawingCanvas />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");
    const id = canvas.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const desc = document.getElementById(id);
    expect(desc).toBeInTheDocument();
    expect(desc).toHaveTextContent(/그려|드로잉|그림/);
  });

  it("설명 문구가 페인트통과 이미지 업로드 경로를 안내한다", () => {
    render(<DrawingCanvas />);
    const canvas = screen.getByLabelText("물고기 그리기 캔버스");
    const desc = document.getElementById(canvas.getAttribute("aria-describedby"));
    expect(desc).toHaveTextContent(/페인트통/);
    expect(desc).toHaveTextContent(/이미지/);
  });

  it("도구 컨트롤은 접근 가능한 이름을 가지며 키보드 포커스가 가능하다", () => {
    render(<DrawingCanvas />);
    const bucket = screen.getByRole("button", { name: "페인트통" });
    const eraser = screen.getByRole("button", { name: "지우개" });
    const undo = screen.getByRole("button", { name: "실행 취소" });
    const clear = screen.getByRole("button", { name: "초기화" });
    const upload = screen.getByLabelText("이미지 올리기");

    for (const el of [bucket, eraser, undo, clear]) {
      expect(el).toBeEnabled();
    }
    expect(upload).toBeInTheDocument();

    // 네이티브 button 은 기본적으로 포커스 가능(tabindex 음수 아님).
    bucket.focus();
    expect(bucket).toHaveFocus();
  });
});
