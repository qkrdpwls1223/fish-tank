import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

// 상위 뷰 전환: 공유 어항 ↔ 내 수집함 (REQ-COLL-002).
// authenticate/tankProps/collectionProps 를 주입해 네트워크 없이 전환 동작을 검증한다.

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

describe("App 뷰 전환 (REQ-COLL-002)", () => {
  it("인증 후 기본 뷰는 공유 어항이며 수집함은 보이지 않는다", async () => {
    const loadCatches = vi.fn().mockResolvedValue([]);
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        collectionProps={{ loadCatches }}
      />,
    );

    expect(await screen.findByLabelText("어항")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "내 수집함" })).toBeNull();
    expect(loadCatches).not.toHaveBeenCalled();
  });

  it("'내 수집함' 버튼을 누르면 수집함 뷰로 전환하고 조회를 시작한다 (REQ-COLL-001)", async () => {
    const loadCatches = vi.fn().mockResolvedValue([]);
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        collectionProps={{ loadCatches }}
      />,
    );

    await screen.findByLabelText("어항");
    await userEvent.click(
      screen.getByRole("button", { name: "내 수집함" }),
    );

    expect(
      await screen.findByRole("heading", { name: "내 수집함" }),
    ).toBeInTheDocument();
    // 수집함 뷰에서는 공유 어항 캔버스가 언마운트된다(분리된 별도 화면).
    expect(screen.queryByLabelText("어항")).toBeNull();
    await waitFor(() =>
      expect(loadCatches).toHaveBeenCalledWith({ token: "tok-abc" }),
    );
  });

  it("수집함에서 '공유 어항' 버튼을 누르면 다시 어항 뷰로 돌아온다", async () => {
    const loadCatches = vi.fn().mockResolvedValue([]);
    render(
      <App
        authenticate={authOk()}
        tankProps={tankDeps()}
        collectionProps={{ loadCatches }}
      />,
    );

    await screen.findByLabelText("어항");
    await userEvent.click(screen.getByRole("button", { name: "내 수집함" }));
    await screen.findByRole("heading", { name: "내 수집함" });

    await userEvent.click(screen.getByRole("button", { name: "공유 어항" }));

    expect(await screen.findByLabelText("어항")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "내 수집함" })).toBeNull();
  });
});
