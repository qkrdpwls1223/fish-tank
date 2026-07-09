import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

// 앱 셸 UI (REQ-AUTH-001/002/004).
// authenticate 함수를 주입해 SSO+백엔드 호출을 대체한다.
describe("App 셸", () => {
  it("인증 성공 시 사용자 이름을 표시하고 쓰기 액션을 활성화한다", async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ userId: "u1", displayName: "홍길동" });
    render(<App authenticate={authenticate} />);

    // 인증 완료 후 이름 노출 (REQ-AUTH-002).
    expect(await screen.findByText(/홍길동/)).toBeInTheDocument();
    // 쓰기 액션(물고기 그리기)은 활성화 상태 (canWrite === true).
    const drawBtn = screen.getByRole("button", { name: /물고기 그리기/ });
    expect(drawBtn).toBeEnabled();
  });

  it("인증 실패 시 오류 메시지와 재시도 버튼을 표시하고 쓰기 액션을 비활성화한다", async () => {
    const authenticate = vi.fn().mockRejectedValue(new Error("SSO 실패"));
    render(<App authenticate={authenticate} />);

    // 오류 상태 안내 (REQ-AUTH-004).
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // 재시도 경로 제공.
    expect(
      screen.getByRole("button", { name: /다시 시도/ })
    ).toBeInTheDocument();
    // 쓰기 액션 비활성화.
    expect(
      screen.getByRole("button", { name: /물고기 그리기/ })
    ).toBeDisabled();
  });

  it("재시도 버튼을 누르면 다시 인증을 시도하고 성공 시 복구한다", async () => {
    const authenticate = vi
      .fn()
      .mockRejectedValueOnce(new Error("일시 실패"))
      .mockResolvedValueOnce({ userId: "u1", displayName: "복구됨" });
    render(<App authenticate={authenticate} />);

    const retry = await screen.findByRole("button", { name: /다시 시도/ });
    await userEvent.click(retry);

    expect(await screen.findByText(/복구됨/)).toBeInTheDocument();
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("인증 상태에서 '물고기 그리기'를 누르면 등록 UI(캔버스)가 나타난다 (M2)", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      userId: "u1",
      displayName: "홍길동",
      token: "tok-abc",
    });
    render(<App authenticate={authenticate} />);

    const drawBtn = await screen.findByRole("button", {
      name: /물고기 그리기/,
    });
    await userEvent.click(drawBtn);

    expect(
      await screen.findByLabelText("물고기 그리기 캔버스"),
    ).toBeInTheDocument();
  });

  it("인증 성공 시 어항(캔버스)이 렌더링되고 스냅샷을 로드한다 (M3, REQ-RT-004)", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      userId: "u1",
      displayName: "홍길동",
      token: "tok-abc",
    });
    const loadSnapshot = vi.fn().mockResolvedValue([]);
    const connect = vi.fn(() => ({ close: vi.fn() }));
    render(
      <App
        authenticate={authenticate}
        tankProps={{ loadSnapshot, connect }}
      />,
    );

    expect(await screen.findByLabelText("어항")).toBeInTheDocument();
    await waitFor(() => expect(loadSnapshot).toHaveBeenCalledWith("tok-abc"));
  });

  it("인증 전에는 어항을 렌더링하지 않는다 (REQ-AUTH-004)", async () => {
    const authenticate = vi.fn().mockRejectedValue(new Error("SSO 실패"));
    render(<App authenticate={authenticate} />);

    await screen.findByRole("alert");
    expect(screen.queryByLabelText("어항")).not.toBeInTheDocument();
  });
});
