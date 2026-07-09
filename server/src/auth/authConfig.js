import { createRemoteJWKSet } from "jose";
import { verifyTeamsToken } from "./verifyTeamsToken.js";

/**
 * 환경 변수에서 Teams SSO 검증 파라미터를 유도한다.
 * @param {Record<string,string|undefined>} env
 * @returns {{issuer:string, audience:string, jwksUri:string}}
 */
export function buildAuthParams(env) {
  const tenantId = env.TEAMS_TENANT_ID;
  const clientId = env.TEAMS_APP_CLIENT_ID;
  if (!tenantId) throw new Error("환경 변수 TEAMS_TENANT_ID 가 필요합니다.");
  if (!clientId) throw new Error("환경 변수 TEAMS_APP_CLIENT_ID 가 필요합니다.");

  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const audience = env.TEAMS_APP_ID_URI || clientId;
  const jwksUri =
    env.TEAMS_JWKS_URI ||
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

  return { issuer, audience, jwksUri };
}

/**
 * 환경 변수 기반으로 원격 JWKS 를 사용하는 검증 함수를 만든다.
 * app.js 의 createApp({ verify }) 에 주입한다.
 * @param {Record<string,string|undefined>} env
 * @returns {(token:string)=>Promise<object>}
 */
export function createVerifierFromEnv(env) {
  const { issuer, audience, jwksUri } = buildAuthParams(env);
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  return (token) => verifyTeamsToken(token, { jwks, audience, issuer });
}
