// @MX:ANCHOR: [AUTO] Teams SSO 토큰 검증 — 모든 쓰기 경로의 보안 경계
// @MX:REASON: NFR-SEC-001. 클라이언트 값 신뢰 금지. authMiddleware 및 향후 모든
//   쓰기 라우트(물고기 추가/삭제/먹이주기)가 이 함수에 의존한다(fan_in >= 3 예상).
import { jwtVerify } from "jose";
import { AuthError } from "./errors.js";

// jose 검증 에러를 우리 도메인 에러 코드로 매핑한다.
function mapJoseError(err) {
  const code = err?.code;
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return new AuthError("expired", "토큰이 만료되었습니다.");
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      if (err.claim === "aud")
        return new AuthError("invalid_audience", "audience 불일치.");
      if (err.claim === "iss")
        return new AuthError("invalid_issuer", "issuer 불일치.");
      return new AuthError("invalid_claim", "클레임 검증 실패.");
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
    case "ERR_JWKS_NO_MATCHING_KEY":
      return new AuthError("invalid_signature", "서명 검증 실패.");
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
    case "ERR_JWT_MALFORMED":
      return new AuthError("malformed", "토큰 형식이 올바르지 않습니다.");
    default:
      return new AuthError("malformed", "토큰을 검증할 수 없습니다.");
  }
}

/**
 * Teams SSO 토큰을 검증하고 인증된 신원을 반환한다.
 * @param {string} token - Bearer JWT
 * @param {object} deps
 * @param {Function} deps.jwks - jose 키셋 리졸버(createRemoteJWKSet/createLocalJWKSet)
 * @param {string|string[]} deps.audience - 기대 audience
 * @param {string|string[]} deps.issuer - 기대 issuer
 * @returns {Promise<{userId:string, displayName:string, tenantId:string}>}
 * @throws {AuthError}
 */
export async function verifyTeamsToken(token, { jwks, audience, issuer }) {
  if (!token || typeof token !== "string") {
    throw new AuthError("malformed", "토큰이 비어 있습니다.");
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { audience, issuer }));
  } catch (err) {
    throw mapJoseError(err);
  }

  // 필수 신원 클레임 확인 (REQ-AUTH-002 — 소유자 근거).
  const userId = payload.oid;
  if (!userId) {
    throw new AuthError("missing_claim", "필수 신원 클레임(oid)이 없습니다.");
  }

  return {
    userId,
    displayName: payload.name ?? "",
    tenantId: payload.tid ?? "",
  };
}
