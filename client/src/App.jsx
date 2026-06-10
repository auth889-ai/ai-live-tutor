import React, { useEffect, useMemo, useState } from "react";
import Agent1VisualRenderer from "./features/googleLiveTutor/components/Agent1VisualRenderer.jsx";
import Stage2LiveTutorWorkbench from "./features/googleLiveTutor/components/Stage2LiveTutorWorkbench.jsx";
import "./App.css";

const API_BASE =
  import.meta.env.VITE_GOOGLE_LIVE_TUTOR_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000/api";

const AUTH_STORAGE_KEY = "glt_real_auth_v1";

const DEFAULT_WORKSPACE = {
  name: "Jana",
  ownerKey: "jana_test",
  password: "1234",
  deviceId: "jana_test_device",
};

const AGENTS = [
  "Understanding Agent",
  "Intent Classification Agent",
  "Source Grounding Agent",
  "Concept Extraction Agent",
  "Concept Tree Builder",
  "Visual Planner Agent",
  "Board Writer Agent",
  "Diagram Agent",
  "Flowchart Agent",
  "Table Agent",
  "Example Agent",
  "Voice Script Agent",
  "Quiz Generator Agent",
  "Mistake Finder Agent",
  "Complexity Agent",
  "Summary Agent",
  "Subtitle Agent",
  "QA Agent",
  "Refiner Agent",
  "Consistency Agent",
  "Quality Assurance Agent",
  "Finalizer Agent",
  "Formatter Agent",
  "Renderer Agent",
  "Voice Renderer Agent",
  "Subtitle Renderer Agent",
  "Board Sync Agent",
];

function cleanText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim() || fallback;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw);
    if (!auth?.token || !auth?.user?.ownerKey) return null;
    syncLegacyIdentity(auth.user);
    return auth;
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  syncLegacyIdentity(auth.user);
}

function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function syncLegacyIdentity(user) {
  const ownerKey = cleanText(user?.ownerKey, DEFAULT_WORKSPACE.ownerKey);
  const deviceId = cleanText(user?.deviceId, `${ownerKey}_device`);

  localStorage.setItem("agent1_owner_key", ownerKey);
  localStorage.setItem("agent1_offline_user_id", cleanText(user?.offlineUserId, ownerKey));
  localStorage.setItem("agent1_device_id", deviceId);
}

async function parseResponse(response) {
  const text = await response.text();

  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!response.ok || json.ok === false) {
    const error = new Error(json.error || text || `HTTP ${response.status}`);
    error.payload = json;
    error.statusCode = json.statusCode || response.status;
    throw error;
  }

  return json;
}

async function authRequest(path, body) {
  const response = await fetch(`${API_BASE}/google-agent/live-tutor/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseResponse(response);
}

/**
 * Existing Stage2LiveTutorWorkbench uses fetch internally.
 * This wrapper injects Authorization token into all live tutor API calls,
 * so old components become backend-auth compatible without rewriting them now.
 */
function installLiveTutorFetchAuth(token) {
  if (window.__gltOriginalFetch) {
    window.fetch = window.__gltOriginalFetch;
  }

  window.__gltOriginalFetch = window.fetch.bind(window);

  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const shouldAttach =
      token &&
      (url.includes("/api/google-agent/live-tutor") ||
        url.includes("localhost:3000/api/google-agent/live-tutor"));

    if (!shouldAttach) {
      return window.__gltOriginalFetch(input, init);
    }

    const currentHeaders = new Headers(init.headers || {});
    currentHeaders.set("Authorization", `Bearer ${token}`);

    return window.__gltOriginalFetch(input, {
      ...init,
      headers: currentHeaders,
    });
  };
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState(DEFAULT_WORKSPACE.name);
  const [ownerKey, setOwnerKey] = useState(DEFAULT_WORKSPACE.ownerKey);
  const [password, setPassword] = useState(DEFAULT_WORKSPACE.password);
  const [deviceId, setDeviceId] = useState(DEFAULT_WORKSPACE.deviceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const payload = {
        name,
        password,
        deviceId,
      };

      if (mode === "register") {
        payload.ownerKey = ownerKey;
      }

      const data = await authRequest(mode === "register" ? "/register" : "/login", payload);

      const auth = {
        token: data.token,
        user: data.user,
        auth: data.auth,
        loginAt: new Date().toISOString(),
      };

      writeAuth(auth);
      onAuth(auth);
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glt-login-page">
      <div className="glt-login-glow one" />
      <div className="glt-login-glow two" />

      <form className="glt-login-card" onSubmit={submit}>
        <div className="glt-login-brand">
          <div className="glt-logo-mark">✦</div>
          <div>
            <h1>Lumina AI Tutor</h1>
            <p>Real source-grounded tutor workspace</p>
          </div>
        </div>

        <div className="glt-auth-switch">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Login
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Register
          </button>
        </div>

        <div className="glt-login-note">
          Backend auth is required. After login, backend token decides <b>ownerKey</b>, not random frontend identity.
        </div>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jana" />
        </label>

        {mode === "register" ? (
          <label>
            Owner key
            <input value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)} placeholder="jana_test" />
            <small>Use jana_test if your current uploaded resource belongs to jana_test.</small>
          </label>
        ) : null}

        <label>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
        </label>

        <label>
          Device ID
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
        </label>

        {error ? <div className="glt-error-box">{error}</div> : null}

        <button className="glt-login-submit" type="submit" disabled={busy}>
          {busy ? "Please wait..." : mode === "register" ? "Create account" : "Enter tutor board"}
        </button>
      </form>
    </div>
  );
}

function LeftAgentRail({ tab, setTab }) {
  return (
    <aside className="glt-left-rail">
      <div className="glt-resource-card">
        <div className="glt-resource-cover">PDF</div>
        <div>
          <b>Resource Workspace</b>
          <span>PDF → concept tree → live tutor board</span>
          <em>Source Grounded</em>
        </div>
      </div>

      <nav className="glt-side-nav">
        <button className={tab === "lesson" ? "active" : ""} onClick={() => setTab("lesson")}>
          Overview & Live Board
        </button>
        <button className={tab === "agent1" ? "active" : ""} onClick={() => setTab("agent1")}>
          Visual Extraction
        </button>
        <button className={tab === "auth" ? "active" : ""} onClick={() => setTab("auth")}>
          Auth / Workspace
        </button>
      </nav>

      <div className="glt-agent-card">
        <div className="glt-agent-heading">27-Agent Teaching Team</div>

        <div className="glt-agent-ring">
          <div>
            <b>25/27</b>
            <span>Agents</span>
          </div>
        </div>

        <div className="glt-agent-list">
          {AGENTS.map((agent, index) => {
            const done = index < 25;
            const current = index === 25;

            return (
              <div key={agent} className={current ? "current" : done ? "done" : ""}>
                <span>{index + 1}. {agent}</span>
                <b>{done ? "✓" : current ? "◌" : "○"}</b>
              </div>
            );
          })}
        </div>

        <div className="glt-grounded-badge">
          <b>Grounded & Verified</b>
          <span>All explanations must be source-backed.</span>
        </div>
      </div>
    </aside>
  );
}

function RightTutorRail({ auth }) {
  const user = safeObject(auth?.user);

  return (
    <aside className="glt-right-rail">
      <div className="glt-ai-card">
        <div className="glt-ai-avatar">👩🏻‍🏫</div>
        <div>
          <div className="glt-online-row">
            <span />
            Tutor Online
          </div>
          <h3>AI Tutor</h3>
          <p>
            Hi {user.displayName || "student"}! I’ll explain your PDF like a real teacher:
            board, voice script, subtitles, examples, quiz, and sources.
          </p>
        </div>
      </div>

      <div className="glt-action-card">
        <h4>Suggested Actions</h4>
        <button type="button">Explain selected node</button>
        <button type="button">Show related concept tree</button>
        <button type="button">Generate practice quiz</button>
        <button type="button">View all sources</button>
      </div>

      <div className="glt-confidence-card">
        <div className="glt-confidence-top">
          <span>Confidence</span>
          <b>High</b>
        </div>
        <div className="glt-confidence-meter">
          <span />
        </div>
        <p>Sources Used: dynamic from selected node</p>
        <p>Verification: backend source-grounded</p>
      </div>

      <div className="glt-summary-card">
        <h4>Auto-Expanding Lesson Board</h4>
        <p>
          Final goal: AI teaches across multiple connected screens, with synced voice/subtitles
          and source references.
        </p>
        <div className="glt-board-steps">
          <span className="active">1</span>
          <span>2</span>
          <span>3</span>
        </div>
      </div>
    </aside>
  );
}

function AuthWorkspacePage({ auth }) {
  const user = safeObject(auth?.user);

  return (
    <section className="glt-auth-page-panel">
      <h2>Backend Authentication Active</h2>
      <p>
        This frontend now stores a backend token and injects it into Live Tutor API calls.
        Existing Stage2 components still work because legacy localStorage identity is synced.
      </p>

      <div className="glt-auth-grid">
        <div>
          <span>Name</span>
          <b>{user.displayName || "—"}</b>
        </div>
        <div>
          <span>ownerKey</span>
          <b>{user.ownerKey || "—"}</b>
        </div>
        <div>
          <span>offlineUserId</span>
          <b>{user.offlineUserId || user.ownerKey || "—"}</b>
        </div>
        <div>
          <span>deviceId</span>
          <b>{user.deviceId || "—"}</b>
        </div>
      </div>

      <div className="glt-auth-token-box">
        <h3>Token proof</h3>
        <p>
          Token exists: <b>{auth?.token ? "yes" : "no"}</b>
        </p>
        <pre>{auth?.token ? `${auth.token.slice(0, 42)}...` : "No token"}</pre>
      </div>
    </section>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => readAuth());
  const [tab, setTab] = useState("lesson");

  useEffect(() => {
    if (auth?.token) {
      installLiveTutorFetchAuth(auth.token);
      syncLegacyIdentity(auth.user);
    }
  }, [auth]);

  if (!auth?.token) {
    return <AuthScreen onAuth={setAuth} />;
  }

  function logout() {
    clearAuth();
    setAuth(null);
  }

  return (
    <div className="glt-app">
      <header className="glt-topbar">
        <div className="glt-brand">
          <div className="glt-logo-mark">✦</div>
          <div>
            <b>Lumina</b>
            <span>AI Tutor Board</span>
          </div>
        </div>

        <div className="glt-search">
          <span>⌕</span>
          <input placeholder="Search topics, nodes, resources..." />
          <kbd>⌘ K</kbd>
        </div>

        <div className="glt-top-actions">
          <div className="glt-status-pill">
            <span />
            AI Tutor Online
          </div>
          <button type="button" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="glt-layout">
        <LeftAgentRail tab={tab} setTab={setTab} />

        <main className="glt-center">
          {tab === "lesson" ? (
            <div className="glt-stage-shell">
              <Stage2LiveTutorWorkbench />
            </div>
          ) : null}

          {tab === "agent1" ? (
            <div className="glt-stage-shell">
              <Agent1VisualRenderer />
            </div>
          ) : null}

          {tab === "auth" ? <AuthWorkspacePage auth={auth} /> : null}
        </main>

        <RightTutorRail auth={auth} />
      </div>
    </div>
  );
}