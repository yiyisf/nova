import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type User } from "./api.ts";
import { ChatPage } from "./pages/Chat.tsx";
import { HomePage } from "./pages/Home.tsx";
import { LoginPage } from "./pages/Login.tsx";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await api.logout();
    setUser(null);
    navigate("/login");
  }

  if (user === undefined) {
    return (
      <div className="shell">
        <p className="muted">正在载入…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          Nova
        </Link>
        {user ? (
          <div className="row">
            <span className="muted">{user.email}</span>
            <button className="secondary" type="button" onClick={() => void logout()}>
              退出
            </button>
          </div>
        ) : null}
      </header>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onAuth={setUser} />} />
        <Route path="/" element={user ? <HomePage /> : <Navigate to="/login" replace />} />
        <Route path="/bots/:botId" element={user ? <ChatPage /> : <Navigate to="/login" replace />} />
      </Routes>
    </div>
  );
}
