/**
 * extension/core/overlayChat.js
 * ------------------------------------------------------------
 * Browser overlay chat for AI-human conversation.
 *
 * Purpose:
 * - Show user/AI chat bubbles on the current webpage.
 * - Show AI thinking/listening/speaking states.
 * - Send typed reply to backend through background.js.
 *
 * Safe/OCP:
 * - Does not replace your old popup/intervention UI.
 * - Adds a separate small floating chat panel.
 */

(function initSfaiOverlayChat(global) {
  const ROOT_ID = "sfai-extension-chat-root";

  const STATE = {
    activeActivityId: "",
    visible: false,
    messages: [],
    status: "idle",
  };

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function ensureStyles() {
    if (document.getElementById("sfai-extension-chat-style")) return;

    const style = document.createElement("style");
    style.id = "sfai-extension-chat-style";
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 340px;
        max-width: calc(100vw - 28px);
        z-index: 2147483647;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
      }

      #${ROOT_ID}.sfai-hidden {
        display: none;
      }

      #${ROOT_ID} .sfai-chat-card {
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(226,232,240,.9);
        box-shadow: 0 20px 55px rgba(15,23,42,.20);
        border-radius: 22px;
        overflow: hidden;
        backdrop-filter: blur(14px);
      }

      #${ROOT_ID} .sfai-chat-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 12px 14px;
        background: linear-gradient(135deg,#111827,#4f46e5);
        color: white;
      }

      #${ROOT_ID} .sfai-chat-title {
        font-size: 13px;
        font-weight: 900;
      }

      #${ROOT_ID} .sfai-chat-status {
        margin-top: 2px;
        font-size: 11px;
        opacity: .82;
        font-weight: 700;
      }

      #${ROOT_ID} .sfai-chat-close {
        border: none;
        background: rgba(255,255,255,.18);
        color: white;
        border-radius: 999px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        font-weight: 900;
      }

      #${ROOT_ID} .sfai-chat-body {
        max-height: 310px;
        overflow-y: auto;
        padding: 12px;
        background: #f8fafc;
      }

      #${ROOT_ID} .sfai-bubble {
        margin: 8px 0;
        max-width: 86%;
        padding: 10px 12px;
        border-radius: 16px;
        font-size: 12px;
        line-height: 1.45;
        word-break: break-word;
      }

      #${ROOT_ID} .sfai-bubble.user {
        margin-left: auto;
        color: white;
        background: #4f46e5;
        border-bottom-right-radius: 5px;
      }

      #${ROOT_ID} .sfai-bubble.ai {
        margin-right: auto;
        color: #0f172a;
        background: white;
        border: 1px solid #e5e7eb;
        border-bottom-left-radius: 5px;
      }

      #${ROOT_ID} .sfai-chat-input-row {
        display: flex;
        gap: 8px;
        padding: 10px;
        background: white;
        border-top: 1px solid #e5e7eb;
      }

      #${ROOT_ID} .sfai-chat-input {
        flex: 1;
        border: 1px solid #d1d5db;
        border-radius: 14px;
        padding: 9px 10px;
        font-size: 12px;
        outline: none;
      }

      #${ROOT_ID} .sfai-chat-send {
        border: none;
        border-radius: 14px;
        padding: 0 13px;
        font-size: 12px;
        font-weight: 900;
        color: white;
        background: #111827;
        cursor: pointer;
      }
    `;

    document.documentElement.appendChild(style);
  }

  function ensureRoot() {
    ensureStyles();

    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "sfai-hidden";

    root.innerHTML = `
      <div class="sfai-chat-card">
        <div class="sfai-chat-head">
          <div>
            <div class="sfai-chat-title">AI Study Coach</div>
            <div class="sfai-chat-status" id="sfai-chat-status">idle</div>
          </div>
          <button class="sfai-chat-close" id="sfai-chat-close">×</button>
        </div>
        <div class="sfai-chat-body" id="sfai-chat-body"></div>
        <div class="sfai-chat-input-row">
          <input id="sfai-chat-input" class="sfai-chat-input" placeholder="Reply to AI..." />
          <button id="sfai-chat-send" class="sfai-chat-send">Send</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);

    root.querySelector("#sfai-chat-close")?.addEventListener("click", hide);

    const send = async () => {
      const input = root.querySelector("#sfai-chat-input");
      const text = String(input?.value || "").trim();
      if (!text) return;

      input.value = "";
      addUserMessage(text);

      try {
        setStatus("sending");
        const res = await chrome.runtime.sendMessage({
          type: "STUDY_VOICE_REPLY",
          payload: {
            activityId: STATE.activeActivityId,
            message: text,
            source: "extension",
            needsScreenshot: true,
          },
        });

        if (!res?.ok) {
          throw new Error(res?.message || "Reply failed");
        }

        const ai = res?.data?.ai || res?.data?.data?.ai || {};
        const reply = ai.reply || ai.voiceText || "";

        if (reply) addAiMessage(reply);
      } catch (error) {
        addAiMessage(`I could not send that reply: ${error.message}`);
        setStatus("error");
      }
    };

    root.querySelector("#sfai-chat-send")?.addEventListener("click", send);
    root.querySelector("#sfai-chat-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        send();
      }
    });

    return root;
  }

  function render() {
    const root = ensureRoot();
    const body = root.querySelector("#sfai-chat-body");
    const status = root.querySelector("#sfai-chat-status");

    if (status) status.textContent = STATE.status || "idle";

    if (!body) return;

    body.innerHTML = STATE.messages
      .slice(-40)
      .map(
        (msg) => `
          <div class="sfai-bubble ${msg.role === "user" ? "user" : "ai"}">
            ${escapeHtml(msg.text)}
          </div>
        `
      )
      .join("");

    body.scrollTop = body.scrollHeight;
  }

  function show() {
    const root = ensureRoot();
    root.classList.remove("sfai-hidden");
    STATE.visible = true;
    render();
  }

  function hide() {
    const root = ensureRoot();
    root.classList.add("sfai-hidden");
    STATE.visible = false;
  }

  function setActiveActivityId(activityId) {
    STATE.activeActivityId = String(activityId || "");
  }

  function setStatus(status) {
    STATE.status = status || "idle";
    render();
  }

  function addMessage(role, text, options = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;

    STATE.messages.push({
      role,
      text: cleanText,
      at: new Date().toISOString(),
      ...options,
    });

    STATE.messages = STATE.messages.slice(-80);
    show();
    render();
  }

  function addUserMessage(text, options = {}) {
    addMessage("user", text, options);
  }

  function addAiMessage(text, options = {}) {
    addMessage("ai", text, options);
  }

  function setMessagesFromConversation(conversation) {
    const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];

    STATE.messages = turns
      .map((turn) => ({
        role: turn.role === "user" ? "user" : "ai",
        text: turn.text,
        at: turn.at,
      }))
      .filter((msg) => msg.text);

    show();
    render();
  }

  global.SFAI_OVERLAY_CHAT = {
    show,
    hide,
    setStatus,
    setActiveActivityId,
    addUserMessage,
    addAiMessage,
    addMessage,
    setMessagesFromConversation,
  };
})(window);