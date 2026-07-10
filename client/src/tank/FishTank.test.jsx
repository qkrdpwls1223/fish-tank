import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FishTank from "./FishTank.jsx";

// 어항 렌더링 + 실시간 반영 통합 (REQ-RT-001/002/003/004, REQ-DRAW-003).
// loadSnapshot 과 connect 를 주입해 네트워크/소켓 없이 데이터 흐름을 검증한다.

function fish(id, extra = {}) {
  return {
    id,
    drawing: { version: 1, width: 100, height: 60, strokes: [] },
    displayMode: "named",
    displayName: `물고기-${id}`,
    createdAt: "2026-07-09T00:00:00.000Z",
    ...extra,
  };
}

// connect 를 가로채 onEvent/onOpen 콜백을 테스트에서 직접 트리거할 수 있게 한다.
function fakeConnect() {
  const captured = {};
  const close = vi.fn();
  const connect = vi.fn((opts) => {
    Object.assign(captured, opts);
    return { close };
  });
  return { connect, captured, close };
}

// 물고기 목록 패널은 기본 닫힘이므로, 목록 내용(라벨/삭제/정보)을 검증하는 테스트는 먼저 연다.
async function openList() {
  await userEvent.click(await screen.findByRole("button", { name: /목록 열기/ }));
}

describe("FishTank", () => {
  it("진입 시 스냅샷을 로드해 모든 물고기를 렌더링한다 (REQ-RT-004)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([fish("a"), fish("b")]);
    const { connect } = fakeConnect();

    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    expect(await screen.findByText("물고기-a")).toBeInTheDocument();
    expect(screen.getByText("물고기-b")).toBeInTheDocument();
    expect(loadSnapshot).toHaveBeenCalledWith("t");
  });

  it("어항 캔버스를 렌더링한다 (REQ-DRAW-003)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    const { connect } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    expect(await screen.findByLabelText("어항")).toBeInTheDocument();
  });

  it("fish_added 이벤트를 받으면 새 물고기가 즉시 나타난다 (REQ-RT-001)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([fish("a")]);
    const { connect, captured } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    await screen.findByText("물고기-a");

    act(() => {
      captured.onEvent({ type: "fish_added", fish: fish("b") });
    });

    expect(await screen.findByText("물고기-b")).toBeInTheDocument();
  });

  it("fish_deleted 이벤트를 받으면 물고기가 즉시 사라진다 (REQ-RT-002)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([fish("a"), fish("b")]);
    const { connect, captured } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    await screen.findByText("물고기-a");

    act(() => {
      captured.onEvent({ type: "fish_deleted", id: "a" });
    });

    await waitFor(() =>
      expect(screen.queryByText("물고기-a")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("물고기-b")).toBeInTheDocument();
  });

  it("재연결(onOpen) 시 스냅샷을 다시 로드해 재동기화한다 (REQ-RT-003)", async () => {
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce([fish("a")])
      .mockResolvedValueOnce([fish("b"), fish("c")]);
    const { connect, captured } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    await screen.findByText("물고기-a");

    await act(async () => {
      captured.onOpen();
    });

    expect(await screen.findByText("물고기-b")).toBeInTheDocument();
    expect(screen.getByText("물고기-c")).toBeInTheDocument();
    expect(screen.queryByText("물고기-a")).not.toBeInTheDocument();
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
  });

  it("익명 물고기는 이름/신원 대신 '익명'으로 표시한다 (REQ-OWN-004)", async () => {
    const loadSnapshot = vi
      .fn()
      .mockResolvedValue([fish("x", { displayMode: "anonymous", displayName: null })]);
    const { connect } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    expect(await screen.findByText("익명")).toBeInTheDocument();
  });

  // M4: 삭제 UI 는 서버가 계산한 deletable 플래그(본인 소유)에만 노출된다.
  // 클라이언트는 내부 ownerId 없이 deletable 만으로 UI 를 판단한다(REQ-OWN-002/004).
  it("삭제 버튼은 본인(deletable) 물고기에만 표시된다 (REQ-OWN-002)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([
      fish("a", { deletable: true }),
      fish("b", { deletable: false }),
    ]);
    const { connect } = fakeConnect();
    render(
      <FishTank
        token="t"
        loadSnapshot={loadSnapshot}
        connect={connect}
        deleteFish={vi.fn()}
      />,
    );

    await openList();
    await screen.findByText("물고기-a");
    const buttons = screen.getAllByRole("button", { name: /삭제/ });
    expect(buttons).toHaveLength(1);
  });

  it("deletable 이 아닌 물고기에는 삭제 버튼이 없다 (REQ-OWN-003)", async () => {
    const loadSnapshot = vi
      .fn()
      .mockResolvedValue([fish("b", { deletable: false })]);
    const { connect } = fakeConnect();
    render(
      <FishTank
        token="t"
        loadSnapshot={loadSnapshot}
        connect={connect}
        deleteFish={vi.fn()}
      />,
    );

    await openList();
    await screen.findByText("물고기-b");
    expect(screen.queryByRole("button", { name: /삭제/ })).toBeNull();
  });

  it("본인 익명 물고기도 deletable 이면 삭제 버튼이 표시된다 (REQ-OWN-001/002)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([
      fish("x", { displayMode: "anonymous", displayName: null, deletable: true }),
    ]);
    const { connect } = fakeConnect();
    render(
      <FishTank
        token="t"
        loadSnapshot={loadSnapshot}
        connect={connect}
        deleteFish={vi.fn()}
      />,
    );

    await openList();
    await screen.findByText("익명");
    expect(screen.getByRole("button", { name: /삭제/ })).toBeInTheDocument();
  });

  it("삭제 버튼을 누르면 deleteFish 를 토큰과 물고기 id 로 호출한다 (REQ-OWN-002, NFR-SEC-001)", async () => {
    const loadSnapshot = vi
      .fn()
      .mockResolvedValue([fish("a", { deletable: true })]);
    const { connect } = fakeConnect();
    const deleteFish = vi.fn().mockResolvedValue(undefined);
    render(
      <FishTank
        token="tok-abc"
        loadSnapshot={loadSnapshot}
        connect={connect}
        deleteFish={deleteFish}
      />,
    );

    await openList();
    await screen.findByText("물고기-a");
    const item = screen.getByText("물고기-a").closest("li");
    await userEvent.click(within(item).getByRole("button", { name: /삭제/ }));

    expect(deleteFish).toHaveBeenCalledWith({ token: "tok-abc", id: "a" });
  });

  it("삭제 요청 후 서버의 실시간 fish_deleted 로 어항에서 사라진다 (REQ-RT-002)", async () => {
    const loadSnapshot = vi
      .fn()
      .mockResolvedValue([fish("a", { deletable: true }), fish("b")]);
    const { connect, captured } = fakeConnect();
    const deleteFish = vi.fn().mockResolvedValue(undefined);
    render(
      <FishTank
        token="t"
        loadSnapshot={loadSnapshot}
        connect={connect}
        deleteFish={deleteFish}
      />,
    );

    await openList();
    await screen.findByText("물고기-a");
    const item = screen.getByText("물고기-a").closest("li");
    await userEvent.click(within(item).getByRole("button", { name: /삭제/ }));

    // 실제 제거는 서버 브로드캐스트(fish_deleted)가 담당한다.
    act(() => {
      captured.onEvent({ type: "fish_deleted", id: "a" });
    });

    await waitFor(() =>
      expect(screen.queryByText("물고기-a")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("물고기-b")).toBeInTheDocument();
  });

  // M5: 먹이주기 (REQ-INT-001, REQ-INT-003).
  it("먹이 주기 버튼을 렌더링한다 (REQ-INT-001)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    const { connect } = fakeConnect();
    render(
      <FishTank
        token="t"
        loadSnapshot={loadSnapshot}
        connect={connect}
        onFeed={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: /먹이/ }),
    ).toBeInTheDocument();
  });

  it("먹이 주기 버튼을 누르면 토큰과 좌표로 onFeed 를 호출한다 (REQ-INT-003, NFR-SEC-001)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    const { connect } = fakeConnect();
    const onFeed = vi.fn().mockResolvedValue(undefined);
    render(
      <FishTank
        token="tok-abc"
        loadSnapshot={loadSnapshot}
        connect={connect}
        onFeed={onFeed}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /먹이/ }));

    expect(onFeed).toHaveBeenCalledTimes(1);
    const arg = onFeed.mock.calls[0][0];
    expect(arg.token).toBe("tok-abc");
    expect(typeof arg.x).toBe("number");
    expect(typeof arg.y).toBe("number");
  });

  it("food_dropped 이벤트를 받아도 크래시 없이 처리한다 (REQ-INT-003)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([fish("a")]);
    const { connect, captured } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    await screen.findByText("물고기-a");
    act(() => {
      captured.onEvent({ type: "food_dropped", food: { x: 100, y: 100 } });
    });
    // 어항은 그대로 유지된다(먹이는 물고기 목록을 바꾸지 않는다).
    expect(screen.getByText("물고기-a")).toBeInTheDocument();
  });

  // M5: 물고기 정보 조회 (REQ-INT-002).
  it("이름 물고기를 클릭하면 표시 이름과 생성 정보를 보여준다 (REQ-INT-002)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([
      fish("a", {
        displayMode: "named",
        displayName: "구피",
        createdAt: "2026-07-09T00:00:00.000Z",
      }),
    ]);
    const { connect } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    await userEvent.click(await screen.findByRole("button", { name: "구피" }));

    const info = screen.getByRole("status", { name: "물고기 정보" });
    expect(within(info).getByText("구피")).toBeInTheDocument();
    expect(within(info).getByText(/2026-07-09/)).toBeInTheDocument();
  });

  it("익명 물고기를 클릭하면 '익명'으로만 표시하고 소유자 신원을 노출하지 않는다 (REQ-INT-002, REQ-OWN-004)", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([
      fish("x", {
        displayMode: "anonymous",
        displayName: null,
        createdAt: "2026-07-09T02:00:00.000Z",
      }),
    ]);
    const { connect } = fakeConnect();
    render(<FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />);
    await openList();

    await userEvent.click(await screen.findByRole("button", { name: "익명" }));

    const info = screen.getByRole("status", { name: "물고기 정보" });
    expect(within(info).getByText("익명")).toBeInTheDocument();
    expect(within(info).getByText(/2026-07-09/)).toBeInTheDocument();
    // 익명 정보에는 소유자 신원 흔적이 없어야 한다.
    expect(info.textContent).not.toContain("owner");
    expect(info.textContent).not.toContain("userId");
  });

  // 회귀 방지: loadSnapshot 기본 prop 이 매 렌더마다 새 함수면 resync→마운트 useEffect 가
  // 재실행되며 GET /api/fish 와 WS 재연결이 무한 반복된다. 기본값을 주입하지 않고
  // 실제 기본 경로(defaultLoadSnapshot → fetch)를 태워 1회만 호출되는지 확인한다.
  it("기본 로더 경로에서 스냅샷 로드/연결이 한 번만 일어난다 (재요청 루프 회귀 방지)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [fish("a")] });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    const { connect, close } = fakeConnect();
    try {
      render(<FishTank token="t" connect={connect} />);
      await screen.findByLabelText("어항");
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      // 루프 버그가 있으면 resync→dispatch→리렌더→effect 재실행이 폭주한다.
      // 여러 틱을 흘려보낸 뒤에도 호출이 1회로 유지되어야 한다.
      await new Promise((r) => setTimeout(r, 50));

      const snapshotGets = fetchMock.mock.calls.filter(
        ([url, opts]) => url === "/api/fish" && (opts?.method ?? "GET") === "GET",
      );
      expect(snapshotGets).toHaveLength(1);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("언마운트 시 실시간 연결을 닫는다", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    const { connect, close } = fakeConnect();
    const { unmount } = render(
      <FishTank token="t" loadSnapshot={loadSnapshot} connect={connect} />,
    );
    await waitFor(() => expect(connect).toHaveBeenCalled());
    unmount();
    expect(close).toHaveBeenCalled();
  });
});
