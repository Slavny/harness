import ReactDOM from "react-dom/client";
import App, { ErrorBoundary } from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
