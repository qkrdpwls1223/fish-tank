// Teams JS SDK SSO 래퍼. REQ-AUTH-001.
// 실제 SDK 모듈을 주입 가능하게 하여 라이브 Teams 없이 단위 테스트한다.
import * as teamsSdk from "@microsoft/teams-js";

// 원인(cause)을 보존하는 타입드 에러. REQ-AUTH-004 오류 처리에 사용.
export class TeamsAuthError extends Error {
  constructor(code, message, cause) {
    super(message ?? code);
    this.name = "TeamsAuthError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Teams SDK 를 초기화하고 SSO 토큰을 획득한다.
 * @param {{app:object, authentication:object}} teams - 주입 가능한 Teams SDK.
 * @returns {Promise<string>} SSO JWT (서버에서 검증됨).
 * @throws {TeamsAuthError}
 */
export async function acquireTeamsSsoToken(teams = teamsSdk) {
  const { app, authentication } = teams;

  try {
    await app.initialize();
  } catch (cause) {
    throw new TeamsAuthError(
      "init_failed",
      "Teams SDK 초기화에 실패했습니다.",
      cause
    );
  }

  let token;
  try {
    token = await authentication.getAuthToken();
  } catch (cause) {
    throw new TeamsAuthError(
      "token_failed",
      "SSO 토큰 획득에 실패했습니다.",
      cause
    );
  }

  if (!token) {
    throw new TeamsAuthError("empty_token", "SSO 토큰이 비어 있습니다.");
  }
  return token;
}
