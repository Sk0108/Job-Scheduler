import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Moon, Sun, Timer } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { ApiClientError } from "../api/client";

export function Login() {
  const { login, register } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-blob login-blob-1" />
      <div className="login-blob login-blob-2" />
      <button
        className="btn btn-sm btn-icon"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        style={{ position: "absolute", top: 20, right: 20, zIndex: 2 }}
      >
        {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
      </button>
      <motion.form
        className="card login-card"
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <h1 style={{ fontSize: 18, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <motion.span
            style={{ display: "inline-flex" }}
            animate={{ rotate: [0, -10, 10, -6, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 3 }}
          >
            <Timer size={20} />
          </motion.span>
          Job Scheduler Platform
        </h1>
        <div className="tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Create account
          </button>
        </div>

        {mode === "register" && (
          <div className="form-row">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="form-row">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>

        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

        <motion.button
          className="btn btn-primary"
          type="submit"
          disabled={busy}
          style={{ width: "100%" }}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.98 }}
        >
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </motion.button>
      </motion.form>
    </div>
  );
}
