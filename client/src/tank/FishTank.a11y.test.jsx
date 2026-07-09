import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FishTank from "./FishTank.jsx";

// M6 접근성 (NFR-A11Y-001): 상태 변화 라이브 영역 + 키보드 조작 경로.
// loadSnapshot/connect 를 주입해 네트워크 없이 상호작용만 검증한다.

function fakeConnect() {
  const captured = {};
  const connect = vi.fn((opts) => {
    Object.assign(captured, opts);
    return { close: vi.fn() };
  });
  return { connect, captured };
}

function renderTank(extra = {}) {
  const loadSnapshot = vi.fn().mockResolvedValue(extra.fish ?? []);
  const { connect } = fakeConnect();
  render(
    <FishTank
      token="t"
      loadSnapshot={loadSnapshot}
      connect={connect}
      onFeed={vi.fn().mockResolvedValue(undefined)}
      deleteFish={vi.fn()}
    />,
  );
}

describe("FishTank 접근성 (NFR-A11Y-001)", () => {
  it("먹이 주기 안내는 role=status 라이브 영역으로 노출된다", async () => {
    renderTank();
    await userEvent.click(await screen.findByRole("button", { name: /먹이/ }));

    const region = await screen.findByRole("status", { name: "먹이 주기 안내" });
    expect(region).toHaveTextContent(/먹이/);
    expect(region).toHaveAttribute("aria-live");
  });

  it("동일한 먹이 안내를 반복해도 라이브 영역이 다시 announce 되도록 콘텐츠 키가 바뀐다", async () => {
    renderTank();
    const feedBtn = await screen.findByRole("button", { name: /먹이/ });

    await userEvent.click(feedBtn);
    const region = await screen.findByRole("status", { name: "먹이 주기 안내" });
    const first = region.getAttribute("data-announce-count");

    await userEvent.click(feedBtn);
    const after = screen
      .getByRole("status", { name: "먹이 주기 안내" })
      .getAttribute("data-announce-count");

    // 텍스트가 동일해도 announce 카운트가 증가해 스크린리더가 재낭독하도록 한다.
    expect(Number(after)).toBeGreaterThan(Number(first));
  });

  it("먹이 주기 버튼은 키보드(Enter/Space)로 조작할 수 있다", async () => {
    const onFeed = vi.fn().mockResolvedValue(undefined);
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    const { connect } = fakeConnect();
    render(
      <FishTank
        token="t"
        loadSnapshot={loadSnapshot}
        connect={connect}
        onFeed={onFeed}
      />,
    );

    const feedBtn = await screen.findByRole("button", { name: /먹이/ });
    feedBtn.focus();
    expect(feedBtn).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(onFeed).toHaveBeenCalled();
  });

  it("어항 캔버스에는 접근성 설명이 연결되어 있다", async () => {
    renderTank();
    const canvas = await screen.findByLabelText("어항");
    const describedby = canvas.getAttribute("aria-describedby");
    expect(describedby).toBeTruthy();
    // 설명 요소가 실제로 존재하고 대체 안내 문구를 담는다.
    const desc = document.getElementById(describedby);
    expect(desc).toBeInTheDocument();
    expect(desc).toHaveTextContent(/물고기/);
  });
});
