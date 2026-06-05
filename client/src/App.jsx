import React, { useMemo, useState } from "react";
import Agent1VisualRenderer from "./features/googleLiveTutor/components/Agent1VisualRenderer.jsx";
import Stage2LiveTutorWorkbench from "./features/googleLiveTutor/components/Stage2LiveTutorWorkbench.jsx";

const API_BASE =
  import.meta.env.VITE_GOOGLE_LIVE_TUTOR_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000/api";

/**
 * client/src/App.jsx
 * -----------------------------------------------------------------------------
 * Full fixed App.jsx
 *
 * Fixes:
 * ✅ No random ownerKey by default
 * ✅ Auto-migrates old random localStorage user_... / device_... to jana_test
 * ✅ Keeps Agent 1 page
 * ✅ Adds Stage 2 Premium Board tab
 * ✅ Adds Identity tab
 * ✅ Uses same identity as your working curl tests:
 *      offlineUserId = jana_test
 *      deviceId      = device_test
 *      ownerKey      = jana_test
 *
 * Important:
 * Your MongoDB resource "Lecture 03 EDD" is owned by jana_test.
 * If frontend uses random ownerKey, backend correctly returns:
 *   Resource not found for this ownerKey
 */

function makeClientId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function isOldRandomIdentity(value, prefix) {
  return typeof value === "string" && value.startsWith(`${prefix}_`);
}

function getStored(key, fallbackValue) {
  try {
    let value = localStorage.getItem(key);

    // Migration from old random IDs:
    // old frontend created user_1780... and device_1780...
    // those cannot see jana_test resources.
    if (
      !value ||
      (key === "agent1_offline_user_id" && isOldRandomIdentity(value, "user")) ||
      (key === "agent1_device_id" && isOldRandomIdentity(value, "device")) ||
      (key === "agent1_owner_key" && isOldRandomIdentity(value, "user"))
    ) {
      value = fallbackValue;
      localStorage.setItem(key, value);
    }

    return value;
  } catch {
    return fallbackValue;
  }
}

function setStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore localStorage errors
  }
}

function getIdentity() {
  const offlineUserId = getStored("agent1_offline_user_id", "jana_test");
  const deviceId = getStored("agent1_device_id", "device_test");
  const ownerKey = getStored("agent1_owner_key", "jana_test");

  return {
    offlineUserId,
    deviceId,
    ownerKey,
  };
}

function resetIdentityToJanaTest() {
  setStored("agent1_offline_user_id", "jana_test");
  setStored("agent1_device_id", "device_test");
  setStored("agent1_owner_key", "jana_test");
}

async function readJsonResponse(response) {
  const text = await response.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok || json?.ok === false) {
    const message = json?.error || json?.message || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.response = json;
    error.status = response.status;
    throw error;
  }

  return json || {};
}

function headers(json = true) {
  const identity = getIdentity();

  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-offline-user-id": identity.offlineUserId,
    "x-device-id": identity.deviceId,
    "x-owner-key": identity.ownerKey,
  };
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: headers(false),
  });

  return readJsonResponse(response);
}

async function uploadPdf({ file, title }) {
  const form = new FormData();
  form.append("file", file);
  form.append("title", title || file.name || "Uploaded PDF");

  const response = await fetch(`${API_BASE}/google-agent/live-tutor/resources/upload`, {
    method: "POST",
    headers: headers(false),
    body: form,
  });

  return readJsonResponse(response);
}

async function createTextResource({ title, text, url }) {
  const response = await fetch(`${API_BASE}/google-agent/live-tutor/resources/text`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      title: title || "Text / Transcript Resource",
      text,
      url,
      sourceType: url ? "transcript" : "text",
    }),
  });

  return readJsonResponse(response);
}

async function runAgent1({ resourceId, question, visuals }) {
  const response = await fetch(
    `${API_BASE}/google-agent/live-tutor/resources/${encodeURIComponent(
      resourceId
    )}/agent1/text-visual`,
    {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        question,
        studentLevel: "beginner",
        language: "english",
        visuals,
        maxChunks: 120,
        sourceMaxChars: 90000,
        timeoutMs: 300000,
        maxOutputTokens: 8192,
      }),
    }
  );

  return readJsonResponse(response);
}

async function listResources() {
  const response = await fetch(`${API_BASE}/google-agent/live-tutor/resources`, {
    method: "GET",
    headers: headers(false),
  });

  return readJsonResponse(response);
}

async function checkStage2Health() {
  const response = await fetch(`${API_BASE}/google-agent/live-tutor/stage2/health`, {
    method: "GET",
    headers: headers(false),
  });

  return readJsonResponse(response);
}

function ResultJson({ data }) {
  if (!data) return null;

  return (
    <details className="debug-json">
      <summary>Raw JSON result</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

function IdentityPanel({ identity, onIdentityChanged }) {
  const [offlineUserId, setOfflineUserId] = useState(identity.offlineUserId);
  const [deviceId, setDeviceId] = useState(identity.deviceId);
  const [ownerKey, setOwnerKey] = useState(identity.ownerKey);

  function saveIdentity() {
    const finalOfflineUserId = offlineUserId.trim() || "jana_test";
    const finalDeviceId = deviceId.trim() || "device_test";
    const finalOwnerKey = ownerKey.trim() || finalOfflineUserId;

    setStored("agent1_offline_user_id", finalOfflineUserId);
    setStored("agent1_device_id", finalDeviceId);
    setStored("agent1_owner_key", finalOwnerKey);

    onIdentityChanged?.({
      offlineUserId: finalOfflineUserId,
      deviceId: finalDeviceId,
      ownerKey: finalOwnerKey,
    });
  }

  function useJanaTest() {
    resetIdentityToJanaTest();

    setOfflineUserId("jana_test");
    setDeviceId("device_test");
    setOwnerKey("jana_test");

    onIdentityChanged?.({
      offlineUserId: "jana_test",
      deviceId: "device_test",
      ownerKey: "jana_test",
    });
  }

  function useNewPrivateUser() {
    const newOfflineUserId = makeClientId("user");
    const newDeviceId = makeClientId("device");

    setOfflineUserId(newOfflineUserId);
    setDeviceId(newDeviceId);
    setOwnerKey(newOfflineUserId);

    setStored("agent1_offline_user_id", newOfflineUserId);
    setStored("agent1_device_id", newDeviceId);
    setStored("agent1_owner_key", newOfflineUserId);

    onIdentityChanged?.({
      offlineUserId: newOfflineUserId,
      deviceId: newDeviceId,
      ownerKey: newOfflineUserId,
    });
  }

  return (
    <section className="panel identity-panel">
      <div className="panel-title-row">
        <div>
          <h2>Identity / ownerKey</h2>
          <p>
            Use <b>jana_test</b> to access the resource you tested in curl. Use a new
            private user only when you want a separate owner namespace.
          </p>
        </div>

        <div className="button-row no-margin">
          <button type="button" onClick={useJanaTest}>
            Use jana_test
          </button>
          <button type="button" onClick={useNewPrivateUser}>
            New private user
          </button>
        </div>
      </div>

      <div className="identity-grid">
        <label>
          Offline user ID
          <input value={offlineUserId} onChange={(event) => setOfflineUserId(event.target.value)} />
        </label>

        <label>
          Device ID
          <input value={deviceId} onChange={(event) => setDeviceId(event.target.value)} />
        </label>

        <label>
          Owner key
          <input value={ownerKey} onChange={(event) => setOwnerKey(event.target.value)} />
        </label>
      </div>

      <button type="button" onClick={saveIdentity}>
        Save identity
      </button>

      <div className="identity-note">
        Current headers after save:
        <pre>{JSON.stringify({ offlineUserId, deviceId, ownerKey }, null, 2)}</pre>
      </div>
    </section>
  );
}

function Agent1Page({ identity }) {
  const [health, setHealth] = useState(null);
  const [stage2Health, setStage2Health] = useState(null);
  const [resourceList, setResourceList] = useState(null);

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("Lecture 03 EDD.pdf");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");

  const [resource, setResource] = useState(null);
  const [resourceId, setResourceId] = useState("");

  const [question, setQuestion] = useState(
    "From this PDF, create source-grounded visuals like Text2Diagram: flowchart, ER if database entities exist, sequence if process exists, timeline if evolution exists, mindmap/concept map, class/state if relevant, roadmap tree, and a teaching table. Explain each like a private tutor."
  );

  const [result, setResult] = useState(null);

  const visuals = [
    "flowchart",
    "er",
    "sequence",
    "timeline",
    "mindmap",
    "conceptMap",
    "class",
    "state",
    "roadmapTree",
    "table",
  ];

  async function handleHealth() {
    try {
      setError("");
      setStatus("Checking Agent 1 health...");
      const data = await apiGet("/google-agent/live-tutor/agent1/health");
      setHealth(data);
      setStatus(data.ok ? "Agent 1 health OK ✅" : "Agent 1 health returned not OK");
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  async function handleStage2Health() {
    try {
      setError("");
      setStatus("Checking Stage 2 27-agent health...");
      const data = await checkStage2Health();
      setStage2Health(data);
      setStatus(data.ok ? "Stage 2 health OK ✅" : "Stage 2 health returned not OK");
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  async function handleListResources() {
    try {
      setError("");
      setStatus("Loading saved resources...");
      const data = await listResources();
      setResourceList(data);

      const first = data.resources?.[0];
      if (first) {
        setResource(first);
        setResourceId(first.resourceId || "");
      }

      setStatus(`Loaded ${data.resources?.length || 0} resources ✅`);
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  async function handleUpload() {
    try {
      setError("");
      setResult(null);

      if (!file) {
        throw new Error("Choose a PDF/text file first.");
      }

      setStatus("Uploading and chunking resource...");
      const data = await uploadPdf({ file, title });

      setResource(data.resource || data);
      setResourceId(data.resourceId || data.resource?.resourceId || "");
      setStatus(`Uploaded ✅ Resource ID: ${data.resourceId || data.resource?.resourceId}`);
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  async function handleTextResource() {
    try {
      setError("");
      setResult(null);

      if (!text.trim() && !url.trim()) {
        throw new Error("Paste transcript text or URL first.");
      }

      setStatus("Creating text/transcript resource...");
      const data = await createTextResource({
        title: title || "Transcript Resource",
        text,
        url,
      });

      setResource(data.resource || data);
      setResourceId(data.resourceId || data.resource?.resourceId || "");
      setStatus(`Text resource created ✅ Resource ID: ${data.resourceId || data.resource?.resourceId}`);
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  }

  async function handleRunAgent1() {
    try {
      setError("");
      setResult(null);

      const id = resourceId.trim();
      if (!id) {
        throw new Error("Paste or upload a resourceId first.");
      }

      setStatus("Running real Agent 1: PDF/text → Mermaid/table visuals...");
      const data = await runAgent1({
        resourceId: id,
        question,
        visuals,
      });

      setResult(data);
      setStatus(data.ok ? "Agent 1 generated visuals ✅" : "Agent 1 failed");
    } catch (err) {
      setError(err.message);
      if (err.response) {
        console.error("Agent 1 error response:", err.response);
      }
      setStatus("");
    }
  }

  const outputTypes = result?.outputs?.map((item) => ({
    visualFormat: item.visualFormat,
    diagramType: item.diagramType,
    title: item.title,
  }));

  return (
    <>
      <section className="panel">
        <h2>Connection</h2>
        <div className="meta-grid">
          <div>
            <b>API</b>
            <span>{API_BASE}</span>
          </div>
          <div>
            <b>User</b>
            <span>{identity.offlineUserId}</span>
          </div>
          <div>
            <b>Device</b>
            <span>{identity.deviceId}</span>
          </div>
          <div>
            <b>Owner</b>
            <span>{identity.ownerKey}</span>
          </div>
        </div>

        <div className="button-row">
          <button onClick={handleHealth}>Check Agent 1 Health</button>
          <button onClick={handleStage2Health}>Check Stage 2 Health</button>
          <button onClick={handleListResources}>Load Resources</button>
        </div>

        {health ? (
          <pre className="mini-json">
            {JSON.stringify(
              {
                ok: health.ok,
                agent: health.agent,
                realPythonAgent: health.realPythonAgent,
                realGeminiAgent: health.realGeminiAgent,
                mcpConfigured: health.mcpConfigured,
                supportedVisuals: health.supportedVisuals,
              },
              null,
              2
            )}
          </pre>
        ) : null}

        {stage2Health ? (
          <pre className="mini-json">
            {JSON.stringify(
              {
                ok: stage2Health.ok,
                service: stage2Health.service,
                agentCount: stage2Health.agentCount,
                healthOk: stage2Health.healthOk,
                fallbackUsed: stage2Health.metadata?.fallbackUsed,
              },
              null,
              2
            )}
          </pre>
        ) : null}

        {resourceList ? (
          <pre className="mini-json">
            {JSON.stringify(
              {
                ok: resourceList.ok,
                count: resourceList.count,
                ownerKey: resourceList.metadata?.ownerKey,
                resources: resourceList.resources?.map((item) => ({
                  title: item.title,
                  resourceId: item.resourceId,
                  ownerKey: item.ownerKey,
                  status: item.status,
                  chunks: item.extraction?.chunkCount,
                })),
              },
              null,
              2
            )}
          </pre>
        ) : null}
      </section>

      <section className="panel">
        <h2>1. Upload PDF / Resource</h2>

        <label>
          Resource title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label>
          Choose PDF/Text file
          <input
            type="file"
            accept=".pdf,.txt,.md,text/plain,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>

        <button onClick={handleUpload}>Upload file</button>

        <div className="or">or</div>

        <label>
          Paste transcript/text
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste transcript, notes, or page text here..."
            rows={5}
          />
        </label>

        <label>
          Transcript / text URL
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
          />
        </label>

        <button onClick={handleTextResource}>Create text/url resource</button>
      </section>

      <section className="panel">
        <h2>2. Start Agent 1 from resourceId</h2>

        <label>
          Resource ID
          <input
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
            placeholder="glt_resource_..."
          />
        </label>

        {resource ? (
          <div className="resource-card">
            <b>Selected resource</b>
            <span>{resource.title}</span>
            <span>ID: {resource.resourceId}</span>
            <span>Owner: {resource.ownerKey || "?"}</span>
            <span>
              Pages: {resource.extraction?.pageCount || "?"} · Chunks:{" "}
              {resource.extraction?.chunkCount || "?"}
            </span>
          </div>
        ) : null}

        <label>
          Agent 1 request
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={5}
          />
        </label>

        <div className="chips">
          {visuals.map((visual) => (
            <span key={visual}>{visual}</span>
          ))}
        </div>

        <button className="primary" onClick={handleRunAgent1}>
          Run Agent 1 Visual Teacher
        </button>
      </section>

      {status ? <div className="status">{status}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      {result ? (
        <section className="panel">
          <h2>3. Agent 1 Result</h2>
          <div className="meta-grid">
            <div>
              <b>Passed</b>
              <span>{String(result.agent1Passed || result.ok)}</span>
            </div>
            <div>
              <b>Outputs</b>
              <span>{result.outputs?.length || 0}</span>
            </div>
            <div>
              <b>Voice lines</b>
              <span>{result.voiceScript?.length || 0}</span>
            </div>
            <div>
              <b>Mongo read</b>
              <span>{String(result.metadata?.mongoResourceRead)}</span>
            </div>
          </div>

          <pre className="mini-json">{JSON.stringify(outputTypes, null, 2)}</pre>

          <Agent1VisualRenderer result={result} />
          <ResultJson data={result} />
        </section>
      ) : null}
    </>
  );
}

export default function App() {
  const [identityVersion, setIdentityVersion] = useState(0);
  const [activeTab, setActiveTab] = useState("stage2");

  const identity = useMemo(() => {
    void identityVersion;
    return getIdentity();
  }, [identityVersion]);

  function handleUseJanaTest() {
    resetIdentityToJanaTest();
    setIdentityVersion((value) => value + 1);
  }

  return (
    <div className={activeTab === "stage2" ? "stage2-app-shell" : "app"}>
      <style>{styles}</style>

      {activeTab !== "stage2" ? (
        <header className="hero">
          <div>
            <p className="kicker">AI Live Tutor Rebuild</p>
            <h1>Agent 1 + Stage 2 Human Live Tutor</h1>
            <p>
              Agent 1 handles PDF/Text → visual extraction. Stage 2 uses the 27-agent
              pipeline for concept tree, detailed explanation, boardCommands, handwriting,
              voice script, subtitles, quiz, and interrupt/repair.
            </p>
          </div>

          <button type="button" onClick={handleUseJanaTest}>
            Use jana_test
          </button>
        </header>
      ) : null}

      <nav className="mode-tabs">
        <button
          type="button"
          className={activeTab === "stage2" ? "active" : ""}
          onClick={() => setActiveTab("stage2")}
        >
          Stage 2 Premium Board
        </button>

        <button
          type="button"
          className={activeTab === "agent1" ? "active" : ""}
          onClick={() => setActiveTab("agent1")}
        >
          Agent 1 Visuals
        </button>

        <button
          type="button"
          className={activeTab === "identity" ? "active" : ""}
          onClick={() => setActiveTab("identity")}
        >
          Identity
        </button>

        <button type="button" onClick={handleUseJanaTest}>
          Use jana_test
        </button>
      </nav>

      {activeTab === "stage2" ? <Stage2LiveTutorWorkbench /> : null}

      {activeTab === "agent1" ? <Agent1Page identity={identity} /> : null}

      {activeTab === "identity" ? (
        <IdentityPanel
          identity={identity}
          onIdentityChanged={() => setIdentityVersion((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}

const styles = `
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #fff7ed;
    color: #1f2937;
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .app {
    max-width: 1180px;
    margin: 0 auto;
    padding: 28px 18px 80px;
  }

  .stage2-app-shell {
    min-height: 100vh;
    background: #020617;
  }

  .stage2-app-shell .mode-tabs {
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px 18px 8px;
  }

  .hero,
  .panel {
    background: rgba(255,255,255,.86);
    border: 1px solid rgba(124,58,237,.15);
    border-radius: 28px;
    box-shadow: 0 20px 70px rgba(87,59,31,.12);
  }

  .hero {
    padding: 28px;
    display: flex;
    justify-content: space-between;
    gap: 18px;
    align-items: center;
    margin-bottom: 18px;
  }

  .kicker {
    margin: 0 0 6px;
    color: #7c3aed;
    text-transform: uppercase;
    letter-spacing: .16em;
    font-weight: 900;
    font-size: 12px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 34px;
    letter-spacing: -.04em;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 22px;
  }

  p {
    margin: 0;
    line-height: 1.6;
    color: #62564c;
  }

  .panel {
    padding: 22px;
    margin: 18px 0;
  }

  .panel-title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }

  label {
    display: grid;
    gap: 7px;
    margin-bottom: 14px;
    font-weight: 800;
    color: #463f39;
  }

  input,
  textarea {
    width: 100%;
    border: 1px solid rgba(124,58,237,.18);
    background: #fff;
    border-radius: 16px;
    padding: 12px 14px;
    font: inherit;
    color: #1f2937;
    outline: none;
  }

  input:focus,
  textarea:focus {
    border-color: rgba(124,58,237,.55);
    box-shadow: 0 0 0 4px rgba(124,58,237,.10);
  }

  button {
    border: 0;
    border-radius: 16px;
    background: #1f2937;
    color: white;
    padding: 12px 18px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 12px 30px rgba(31,41,55,.18);
  }

  button.primary {
    background: linear-gradient(135deg, #7c3aed, #2563eb);
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }

  .button-row.no-margin {
    margin-top: 0;
  }

  .mode-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 16px;
  }

  .mode-tabs button {
    background: rgba(31, 41, 55, 0.9);
    border: 1px solid rgba(255,255,255,.12);
  }

  .mode-tabs button.active {
    background: linear-gradient(135deg, #06b6d4, #7c3aed);
  }

  .stage2-app-shell .mode-tabs button {
    box-shadow: none;
  }

  .or {
    margin: 18px 0;
    color: #8a7c70;
    font-weight: 900;
    text-align: center;
  }

  .meta-grid,
  .identity-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .identity-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 18px;
  }

  .meta-grid > div,
  .resource-card {
    border: 1px solid rgba(124,58,237,.12);
    border-radius: 18px;
    background: rgba(124,58,237,.05);
    padding: 13px;
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .meta-grid b,
  .resource-card b {
    color: #4c1d95;
  }

  .meta-grid span,
  .resource-card span {
    overflow-wrap: anywhere;
    color: #4f463f;
    font-size: 13px;
  }

  .resource-card {
    margin: 14px 0;
  }

  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin: 10px 0 16px;
  }

  .chips span {
    border-radius: 999px;
    background: rgba(124,58,237,.08);
    border: 1px solid rgba(124,58,237,.14);
    color: #5b21b6;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 900;
  }

  .status,
  .error {
    border-radius: 18px;
    padding: 14px 16px;
    margin: 18px 0;
    font-weight: 900;
  }

  .status {
    background: #ecfdf5;
    color: #065f46;
    border: 1px solid rgba(16,185,129,.22);
  }

  .error {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid rgba(239,68,68,.22);
  }

  .mini-json,
  .debug-json pre,
  .identity-note pre {
    background: #1f2937;
    color: #f8fafc;
    border-radius: 18px;
    padding: 14px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
  }

  .identity-note {
    margin-top: 18px;
    color: #4f463f;
    font-weight: 800;
  }

  .debug-json {
    margin-top: 18px;
  }

  .debug-json summary {
    cursor: pointer;
    font-weight: 900;
    color: #7c3aed;
  }

  @media (max-width: 780px) {
    .hero,
    .panel-title-row {
      flex-direction: column;
      align-items: flex-start;
    }

    .meta-grid,
    .identity-grid {
      grid-template-columns: 1fr;
    }
  }
`;