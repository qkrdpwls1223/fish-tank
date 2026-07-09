// @MX:WARN: [AUTO] 개발 전용 인증 우회. 절대 프로덕션에서 활성화 금지.
// @MX:REASON: NFR-SEC-001/002. Teams 없이 로컬에서 앱을 시험하기 위한 우회 경로다.
//   실제 토큰 검증(verifyTeamsToken)은 건드리지 않으며, 이 경로는 두 겹으로 게이팅한다:
//   (1) DEV_AUTH_BYPASS 플래그가 명시적으로 켜져야 하고 (2) NODE_ENV 가 production 이면
//   플래그가 있어도 무시하고 실제 검증을 사용한다.
import { createVerifierFromEnv } from "./authConfig.js";

// 개발 우회로 부여되는 고정 신원. userId 는 안정적이어야 소유권/삭제(REQ-OWN-*)가
// 세션 간 일관되게 동작한다.
export const DEV_IDENTITY = Object.freeze({
  userId: "dev-user-local",
  displayName: "개발자(로컬)",
  tenantId: "dev-tenant",
});

/**
 * 개발 우회 활성화 여부. 기본은 비활성.
 * production 에서는 플래그가 있어도 항상 false.
 * @param {Record<string,string|undefined>} env
 * @returns {boolean}
 */
export function isDevBypassEnabled(env) {
  if (env.NODE_ENV === "production") return false;
  return env.DEV_AUTH_BYPASS === "1" || env.DEV_AUTH_BYPASS === "true";
}

/**
 * 토큰 값과 무관하게 고정 개발 신원을 반환하는 검증 함수.
 * 실제 서명/audience/issuer 검증은 하지 않는다(개발 전용).
 * @returns {(token:string)=>Promise<typeof DEV_IDENTITY>}
 */
export function createDevVerifier() {
  return async () => DEV_IDENTITY;
}

/**
 * 환경에 따라 검증 함수를 선택한다.
 * - 우회 활성: 개발 검증기(경고 로그 출력)
 * - 그 외: 실제 Teams SSO 검증기(createVerifierFromEnv, 기존 경로 불변)
 * @param {Record<string,string|undefined>} env
 * @returns {(token:string)=>Promise<object>}
 */
export function resolveVerifier(env) {
  if (isDevBypassEnabled(env)) {
    // 우회가 조용히 켜져 있지 않도록 명확히 경고한다.
    console.warn(
      "[보안 경고] 개발용 인증 우회(DEV_AUTH_BYPASS)가 활성화되었습니다. " +
        "모든 요청이 고정 개발 신원으로 인증됩니다. 프로덕션에서는 절대 사용하지 마세요."
    );
    return createDevVerifier();
  }
  return createVerifierFromEnv(env);
}
