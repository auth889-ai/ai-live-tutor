import nodemailer from "nodemailer";
function clean(v = "") { return String(v || "").trim(); }
function hasSmtp() { return clean(process.env.SMTP_HOST) && clean(process.env.SMTP_PORT) && clean(process.env.SMTP_USER) && clean(process.env.SMTP_PASS); }

export async function sendSavedLocationEmail({ to, subject = "Your learning resource was saved", treeTitle = "", nodeTitle = "", resourceTitle = "", savedPath = "", url = "", summary = "" }) {
  if (!hasSmtp()) return { sent: false, reason: "SMTP config missing" };
  const target = clean(to || process.env.SMTP_USER);
  if (!target || !target.includes("@")) return { sent: false, reason: "Valid recipient email missing" };

  const transporter = nodemailer.createTransport({
    host: clean(process.env.SMTP_HOST),
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: clean(process.env.SMTP_USER), pass: clean(process.env.SMTP_PASS) },
  });

  const from = clean(process.env.SMTP_FROM) || clean(process.env.SMTP_USER);
  const safePath = savedPath || [treeTitle, nodeTitle].filter(Boolean).join(" > ");
  const text = [
    "Your study resource has been saved.",
    `Tree: ${treeTitle || "Unknown"}`,
    `Node: ${nodeTitle || "Unknown"}`,
    `Resource: ${resourceTitle || "Untitled"}`,
    `Saved path: ${safePath || "Unknown"}`,
    url ? `URL: ${url}` : "",
    summary ? `Summary:\n${summary}` : "",
  ].filter(Boolean).join("\n");

  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><h2>Your study resource has been saved</h2><p><b>Tree:</b> ${treeTitle || "Unknown"}</p><p><b>Node:</b> ${nodeTitle || "Unknown"}</p><p><b>Resource:</b> ${resourceTitle || "Untitled"}</p><p><b>Saved path:</b> ${safePath || "Unknown"}</p>${url ? `<p><b>URL:</b> <a href="${url}">${url}</a></p>` : ""}${summary ? `<h3>Summary</h3><p>${summary}</p>` : ""}</div>`;
  const info = await transporter.sendMail({ from, to: target, subject, text, html });
  return { sent: true, messageId: info.messageId };
}
