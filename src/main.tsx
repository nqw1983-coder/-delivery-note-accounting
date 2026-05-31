import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PasswordGate } from "./components/PasswordGate";
import { isAuthenticated } from "./lib/auth";
import "./styles.css";

function Root() {
  const [authed, setAuthed] = useState(() => isAuthenticated());
  if (!authed) {
    return <PasswordGate onSuccess={() => setAuthed(true)} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
