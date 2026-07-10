import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import MyCollection from "./MyCollection.jsx";

// "내 수집함" 뷰 (REQ-COLL-001~005, REQ-PRIV-004).
// loadCatches 를 주입해 네트워크 없이 렌더링/상태를 검증한다.

function caught(id, extra = {}) {
  return {
    id,
    sourceFishId: `src-${id}`,
    drawing: { version: 1, width: 100, height: 60, strokes: [] },
    displayMode: "named",
    displayName: `물고기-${id}`,
    caughtAt: "2026-07-10T12:00:00.000Z",
    ...extra,
  };
}

describe("MyCollection", () => {
  it("수집함 화면(제목)을 별도 뷰로 렌더링한다 (REQ-COLL-002)", async () => {
    const loadCatches = vi.fn().mockResolvedValue([]);
    render(<MyCollection token="t" loadCatches={loadCatches} />);
    expect(
      await screen.findByRole("heading", { name: "내 수집함" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(loadCatches).toHaveBeenCalledWith({ token: "t" }),
    );
  });

  it("낚은 물고기들을 스냅샷 그림으로 렌더링한다 (REQ-COLL-001, REQ-COLL-003)", async () => {
    const loadCatches = vi
      .fn()
      .mockResolvedValue([caught("a"), caught("b")]);
    render(<MyCollection token="t" loadCatches={loadCatches} />);

    // 각 낚은 물고기는 스냅샷 그림 캔버스(role=img)로 렌더된다.
    expect(
      await screen.findByLabelText("물고기-a의 물고기 그림"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("물고기-b의 물고기 그림"),
    ).toBeInTheDocument();
  });

  it("서버가 준 최신순 그대로 표시한다(재정렬하지 않음) (REQ-COLL-004)", async () => {
    // 서버는 최신순으로 응답한다: b(최신) → a.
    const loadCatches = vi
      .fn()
      .mockResolvedValue([caught("b"), caught("a")]);
    render(<MyCollection token="t" loadCatches={loadCatches} />);

    const list = await screen.findByRole("list", { name: "낚은 물고기 목록" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("물고기-b");
    expect(items[1]).toHaveTextContent("물고기-a");
  });

  it("각 항목에 낚은 시각을 표시한다 (REQ-COLL-004)", async () => {
    const loadCatches = vi.fn().mockResolvedValue([caught("a")]);
    render(<MyCollection token="t" loadCatches={loadCatches} />);

    await screen.findByLabelText("물고기-a의 물고기 그림");
    // 낚은 시각(2026년) 메타데이터가 노출된다(시간대 무관하게 연도 유지).
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("익명 물고기는 소유자 신원 대신 '익명'으로 표시한다 (REQ-PRIV-004)", async () => {
    const loadCatches = vi.fn().mockResolvedValue([
      caught("x", { displayMode: "anonymous", displayName: null }),
    ]);
    render(<MyCollection token="t" loadCatches={loadCatches} />);

    expect(
      await screen.findByLabelText("익명의 물고기 그림"),
    ).toBeInTheDocument();
    expect(screen.getByText("익명")).toBeInTheDocument();
  });

  it("낚은 물고기가 없으면 빈 수집함 안내를 표시한다 (REQ-COLL-005)", async () => {
    const loadCatches = vi.fn().mockResolvedValue([]);
    render(<MyCollection token="t" loadCatches={loadCatches} />);

    expect(await screen.findByText(/아직 낚은 물고기가 없어요/)).toBeInTheDocument();
  });

  it("조회 실패 시 오류 안내를 표시한다", async () => {
    const loadCatches = vi.fn().mockRejectedValue(new Error("boom"));
    render(<MyCollection token="t" loadCatches={loadCatches} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/불러오지 못했어요/);
  });
});
