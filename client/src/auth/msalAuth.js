// 일반 브라우저용 Microsoft SSO (MSAL.js) 래퍼. REQ-AUTH-001.
// Teams 클라이언트 의존을 제거하고, 회사 Entra 테넌트 계정으로만 로그인한다.
// 실제 MSAL 인스턴스를 주입 가능하게 하여 라이브 로그인 없이 단위 테스트한다.
import { PublicClientApplication } from "@azure/msal-browser";

// 원인(cause)을 보존하는 타입드 에러. REQ-AUTH-004 오류 처리에 사용.
export class MsalAuthError extends Error {
  constructor(code, message, cause) {
    super(message ?? code);
    this.name = "MsalAuthError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * 환경 변수에서 MSAL 설정과 API 스코프를 유도한다.
 * 스코프는 서버가 audience 로 검증하는 Application ID URI 기반이다:
 * 기본 api://<clientId>/access_as_user (Teams SSO 시절 Expose an API 스코프 재사용).
 * @param {Record<string,string|undefined>} env - import.meta.env
 * @returns {{msalConfig:object, scopes:string[]}}
 */
export function buildMsalOptions(env) {
  const clientId = env.VITE_TEAMS_APP_CLIENT_ID;
  const tenantId = env.VITE_TEAMS_TENANT_ID;
  if (!clientId) throw new MsalAuthError("config_missing", "환경 변수 VITE_TEAMS_APP_CLIENT_ID 가 필요합니다.");
  if (!tenantId) throw new MsalAuthError("config_missing", "환경 변수 VITE_TEAMS_TENANT_ID 가 필요합니다.");

  const appIdUri = env.VITE_TEAMS_APP_ID_URI || `api://${clientId}`;
  return {
    msalConfig: {
      auth: {
        clientId,
        // 테넌트 고정 authority: 회사 계정 외 로그인 차단(서버 issuer 검증과 이중 방어).
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "sessionStorage" },
    },
    scopes: [`${appIdUri}/access_as_user`],
  };
}

let defaultInstance = null;

function getDefaultInstance() {
  if (!defaultInstance) {
    const { msalConfig } = buildMsalOptions(import.meta.env);
    defaultInstance = new PublicClientApplication(msalConfig);
  }
  return defaultInstance;
}

// 리다이렉트로 페이지를 떠나는 경우 절대 resolve 되지 않는 프로미스를 반환해
// 호출측(App)이 "authenticating" 상태를 유지한 채 네비게이션을 기다리게 한다.
const NAVIGATING = new Promise(() => {});

/**
 * MSAL 리다이렉트 흐름으로 API 액세스 토큰을 획득한다.
 * 1) 리다이렉트 복귀 처리 → 2) 계정 없으면 loginRedirect(페이지 이탈)
 * 3) 계정 있으면 acquireTokenSilent → 실패 시 acquireTokenRedirect.
 * @param {{msalInstance?:object, scopes?:string[]}} deps - 테스트 주입용.
 * @returns {Promise<string>} 액세스 토큰 JWT (서버에서 검증됨).
 * @throws {MsalAuthError}
 */
export async function acquireMsalToken(deps = {}) {
  const msal = deps.msalInstance ?? getDefaultInstance();
  const scopes = deps.scopes ?? buildMsalOptions(import.meta.env).scopes;

  let redirectResult;
  try {
    await msal.initialize();
    redirectResult = await msal.handleRedirectPromise();
  } catch (cause) {
    throw new MsalAuthError("init_failed", "Microsoft 로그인 초기화에 실패했습니다.", cause);
  }

  const account = redirectResult?.account ?? msal.getAllAccounts()[0];
  if (!account) {
    try {
      await msal.loginRedirect({ scopes });
    } catch (cause) {
      throw new MsalAuthError("login_failed", "Microsoft 로그인 이동에 실패했습니다.", cause);
    }
    return NAVIGATING;
  }

  try {
    const { accessToken } = await msal.acquireTokenSilent({ scopes, account });
    if (!accessToken) {
      throw new MsalAuthError("empty_token", "액세스 토큰이 비어 있습니다.");
    }
    return accessToken;
  } catch (cause) {
    if (cause instanceof MsalAuthError) throw cause;
    // 조용한 갱신 실패(세션 만료 등) → 대화형 재로그인으로 폴백.
    try {
      await msal.acquireTokenRedirect({ scopes, account });
    } catch (redirectCause) {
      throw new MsalAuthError("token_failed", "액세스 토큰 획득에 실패했습니다.", redirectCause);
    }
    return NAVIGATING;
  }
}
