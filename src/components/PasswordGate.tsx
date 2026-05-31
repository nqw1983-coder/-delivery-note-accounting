import { useState, type FormEvent } from "react";
import { verifyPassword } from "../lib/auth";

interface PasswordGateProps {
  onSuccess: () => void;
}

export function PasswordGate({ onSuccess }: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      const ok = await verifyPassword(password, remember);
      if (ok) {
        onSuccess();
      } else {
        setError("密码不正确,请重试");
        setPassword("");
      }
    } catch {
      setError("登录失败,请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="password-gate">
      <form onSubmit={handleSubmit} className="password-gate-card" autoComplete="off">
        <h1>送货单记账</h1>
        <p className="password-gate-tagline">手机录入,多端同步</p>

        <label className="password-gate-field">
          <span>请输入访问密码</span>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            inputMode="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            disabled={busy}
          />
        </label>

        <label className="password-gate-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>30 天内免输</span>
        </label>

        {error && <p className="password-gate-error">{error}</p>}

        <button type="submit" disabled={!password || busy}>
          {busy ? "验证中…" : "进入"}
        </button>

        <p className="password-gate-hint">
          忘记密码?联系管理员获取或在代码中重置。
        </p>
      </form>
    </div>
  );
}
