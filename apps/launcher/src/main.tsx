import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
// Chat workspaces own a native runtime process. StrictMode's development-only
// double mount starts a second process while the first is still closing, which
// can leave a Flow branch attached. The desktop app mounts once.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
