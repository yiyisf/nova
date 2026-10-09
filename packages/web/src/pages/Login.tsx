import { useState, type FormEvent } from "react";
import { api, type User } from "../api.ts";

export function LoginPage({ onAuth }: { onAuth: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === "login" ? await api.login(email, password) : await api.signup(email, password);
      onAuth(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel auth stack" onSubmit={(event) => void submit(event)}>
      <h2>{mode === "login" ? "登录" : "注册"}</h2>
      <p className="muted">自托管的多用户个人助手。账号数据只属于你。</p>
      <label>
        邮箱
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" />
      </label>
      <label>
        密码
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <div className="row">
        <button type="submit" disabled={busy}>
          {mode === "login" ? "登录" : "创建账号"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
        </button>
      </div>
    </form>
  );
}
