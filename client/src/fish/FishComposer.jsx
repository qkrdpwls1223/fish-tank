import { useState, useCallback } from "react";
import DrawingCanvas from "../drawing/DrawingCanvas.jsx";
import { validateDrawing } from "../drawing/drawingModel.js";
import { canWrite } from "../auth/authMachine.js";
import { submitFish as defaultSubmitFish } from "./fishApi.js";

// 검증 실패 사유를 한국어 안내 문구로 변환한다(REQ-DRAW-004 안내).
const REASON_MESSAGE = {
  empty: "그림이 비어 있습니다. 물고기를 그려 주세요.",
  too_small: "그림이 너무 작습니다. 조금 더 크게 그려 주세요.",
  too_large: "그림이 너무 큽니다. 획을 줄여 주세요.",
  invalid_format: "그림 형식이 올바르지 않습니다.",
};

function messageForReason(reason) {
  return REASON_MESSAGE[reason] ?? "물고기를 등록할 수 없습니다.";
}

/**
 * 물고기 등록 UI. 자유 드로잉 + 이름/익명 선택 + 사전 검증 + 인증 게이트 제출.
 * @param {{authState:object, token:string|null,
 *          submitFish?:typeof defaultSubmitFish}} props
 */
export default function FishComposer({
  authState,
  token,
  submitFish = defaultSubmitFish,
}) {
  const [drawing, setDrawing] = useState(null);
  const [displayMode, setDisplayMode] = useState("named");
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const writeEnabled = canWrite(authState);
  const handleChange = useCallback((d) => setDrawing(d), []);

  async function handleSubmit() {
    setMessage(null);

    // 클라이언트 사전 검증(서버가 최종 권한, NFR-SEC-003).
    const { valid, reason } = validateDrawing(drawing ?? {});
    if (!valid) {
      setMessage(messageForReason(reason));
      return;
    }

    setSubmitting(true);
    try {
      await submitFish({ token, drawing, displayMode });
      setMessage("물고기를 어항에 풀어놓았어요!");
    } catch (err) {
      setMessage(messageForReason(err.reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2>물고기 그리기</h2>
      <DrawingCanvas onChange={handleChange} />

      <fieldset>
        <legend>등록 방식</legend>
        <label>
          <input
            type="radio"
            name="displayMode"
            value="named"
            checked={displayMode === "named"}
            onChange={() => setDisplayMode("named")}
          />
          이름 표시
        </label>
        <label>
          <input
            type="radio"
            name="displayMode"
            value="anonymous"
            checked={displayMode === "anonymous"}
            onChange={() => setDisplayMode("anonymous")}
          />
          익명
        </label>
      </fieldset>

      <button
        type="button"
        disabled={!writeEnabled || submitting}
        onClick={handleSubmit}
      >
        어항에 풀어놓기
      </button>

      {message && <p role="alert">{message}</p>}
    </section>
  );
}
