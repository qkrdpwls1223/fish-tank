// 브라우저 진입점. index.html 의 #root 에 앱 셸(App)을 마운트한다.
// 테스트는 App 을 직접 import 하므로 이 파일은 런타임 마운트에만 관여한다.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
