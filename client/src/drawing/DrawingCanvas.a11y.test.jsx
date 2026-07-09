import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DrawingCanvas from "./DrawingCanvas.jsx";

// M6 접근성 (NFR-A11Y-001): 드로잉 캔버스의 대체 안내 + 컨트롤 키보드 조작성.
// 캔버스는 포인터 전용이므로, 대체 안내 문구와 접근 가능한 undo/clear 컨트롤을 제공한다.

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

  it("undo/clear 컨트롤은 접근 가능한 이름을 가지며 키보드 포커스가 가능하다", () => {
    render(<DrawingCanvas />);
    const undo = screen.getByRole("button", { name: "실행 취소" });
    const clear = screen.getByRole("button", { name: "초기화" });
    expect(undo).toBeEnabled();
    expect(clear).toBeEnabled();
    // 네이티브 button 은 기본적으로 포커스 가능(tabindex 음수 아님).
    undo.focus();
    expect(undo).toHaveFocus();
  });
});
