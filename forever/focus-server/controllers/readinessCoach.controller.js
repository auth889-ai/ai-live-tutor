import {
  createDeadline,
  listDeadlines,
  updateDeadline,
  deleteDeadline,
  generateReadinessPlan,
  regenerateRecoveryPlan,
  getToday,
  checkinTask,
  getDashboard,
  getOfficialCalendar,
  getReadinessCalendar,
  getTwoCalendar,
  exportIcs,
  getHeavyWeeks,
  scheduleSms,
  handleSmsReply,
  upsertReadinessPreferences,
  getReadinessPreferences,
  getPlanningPreferences,
  updatePlanningPreferences,
  createReadinessTask,
  updateReadinessTask,
  deleteReadinessTask,
  generateDailyReadinessReminders,
  generateHeavyWeekReminders,
  runReadinessReminderSchedulerOnce,
  syncReadinessToGoogleCalendar,
  voiceCoachTurn,
  getVoiceConversation,
  rebalanceAcrossDeadlines,
} from "../services/readinessCoach.service.js";

import {
  getGoogleClassroomAuthUrl,
  exchangeGoogleClassroomCode,
  handleGoogleClassroomCallback,
  importGoogleClassroom,
} from "../services/integrations/readinessGoogleClassroom.service.js";

import { runReadinessSmsWorkerOnce } from "../services/integrations/readinessSms.worker.js";

import {
  offlineVoiceHealth,
  offlineVoiceSpeak,
  offlineVoiceCheckin,
} from "../services/readiness/readinessOfflineVoice.service.js";

function ok(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...data,
  });
}

function fail(res, error) {
  const status = error?.status || error?.statusCode || 500;

  return res.status(status).json({
    ok: false,
    error: error?.message || "Readiness Coach request failed.",
    code: error?.code || "readiness_error",
  });
}

function safeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function frontendBaseUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.EXPO_PUBLIC_WEB_URL ||
    "http://localhost:8081"
  ).replace(/\/+$/, "");
}

function getAuthUserId(req) {
  return String(req.user?._id || req.user?.id || req.user?.email || "").trim();
}

function withUser(req) {
  const userId = getAuthUserId(req);

  if (!userId) {
    const error = new Error("Authenticated user id missing.");
    error.status = 401;
    throw error;
  }

  return {
    ...req.query,
    ...req.body,
    userId,
  };
}

function googleCallbackHtml({
  success,
  title,
  message,
  redirectUrl,
  errorMessage = "",
}) {
  const icon = success ? "✓" : "!";
  const iconBg = success ? "#DDF2ED" : "#FFE1D2";

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${safeHtml(title)}</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #FAF8F1;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #2D2B29;
          }

          .card {
            width: min(560px, 90vw);
            background: #FFFDF7;
            border: 1px solid #E8DECF;
            border-radius: 28px;
            padding: 32px;
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
            text-align: center;
          }

          .icon {
            width: 58px;
            height: 58px;
            border-radius: 20px;
            background: ${iconBg};
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            font-weight: 900;
            margin-bottom: 18px;
          }

          h1 {
            margin: 0;
            font-size: 26px;
            letter-spacing: -0.6px;
          }

          p {
            color: #6E7685;
            font-weight: 700;
            line-height: 1.6;
          }

          code {
            background: #F8F3EA;
            padding: 4px 7px;
            border-radius: 8px;
            color: #7B3C2B;
            word-break: break-word;
          }

          a {
            display: inline-flex;
            margin-top: 14px;
            padding: 12px 18px;
            border-radius: 999px;
            background: #34312E;
            color: white;
            text-decoration: none;
            font-weight: 900;
          }
        </style>

        ${
          success
            ? `<script>
                setTimeout(function () {
                  window.location.href = ${JSON.stringify(redirectUrl)};
                }, 900);
              </script>`
            : ""
        }
      </head>

      <body>
        <div class="card">
          <div class="icon">${icon}</div>
          <h1>${safeHtml(title)}</h1>
          <p>${safeHtml(message)}</p>
          ${errorMessage ? `<p><code>${safeHtml(errorMessage)}</code></p>` : ""}
          <a href="${safeHtml(redirectUrl)}">Back to Readiness Coach</a>
        </div>
      </body>
    </html>
  `;
}

export async function health(req, res) {
  return ok(res, {
    feature: "readiness-coach",
    status: "operational",
    message: "Deadline → Daily Action → Recovery AI is running.",
    time: new Date().toISOString(),
  });
}

export async function dashboard(req, res) {
  try {
    return ok(res, await getDashboard(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function createDeadlineHandler(req, res) {
  try {
    return ok(res, await createDeadline(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function listDeadlinesHandler(req, res) {
  try {
    return ok(res, await listDeadlines(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateDeadlineHandler(req, res) {
  try {
    return ok(
      res,
      await updateDeadline(req.params.deadlineId, withUser(req))
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function deleteDeadlineHandler(req, res) {
  try {
    return ok(res, await deleteDeadline(req.params.deadlineId, withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function generatePlanHandler(req, res) {
  try {
    return ok(res, await generateReadinessPlan(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function regenerateRecoveryHandler(req, res) {
  try {
    return ok(res, await regenerateRecoveryPlan(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function todayHandler(req, res) {
  try {
    return ok(res, await getToday(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function checkinTaskHandler(req, res) {
  try {
    return ok(res, await checkinTask(req.params.taskId, withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function createTaskHandler(req, res) {
  try {
    return ok(res, await createReadinessTask(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function updateTaskHandler(req, res) {
  try {
    return ok(res, await updateReadinessTask(req.params.taskId, withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function deleteTaskHandler(req, res) {
  try {
    return ok(res, await deleteReadinessTask(req.params.taskId, withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function officialCalendarHandler(req, res) {
  try {
    return ok(res, await getOfficialCalendar(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function readinessCalendarHandler(req, res) {
  try {
    return ok(res, await getReadinessCalendar(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function twoCalendarHandler(req, res) {
  try {
    return ok(res, await getTwoCalendar(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function exportIcsHandler(req, res) {
  try {
    const result = await exportIcs(withUser(req));

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`
    );

    return res.status(200).send(result.content);
  } catch (error) {
    return fail(res, error);
  }
}

export async function heavyWeeksHandler(req, res) {
  try {
    return ok(res, await getHeavyWeeks(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function googleAuthUrlHandler(req, res) {
  try {
    return ok(res, await getGoogleClassroomAuthUrl(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function googleExchangeHandler(req, res) {
  try {
    return ok(res, await exchangeGoogleClassroomCode(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

/**
 * Public Google OAuth browser callback.
 *
 * Important:
 * - Google redirects browser here without Authorization header.
 * - This route must be public in routes/readinessCoach.routes.js.
 * - We redirect to Expo root with query param because direct /readiness-coach
 *   can show "Not found" on Expo web dev server.
 */
export async function googleCallbackHandler(req, res) {
  const successRedirectUrl = `${frontendBaseUrl()}/?open=readiness-coach&googleClassroom=connected`;
  const failedRedirectUrl = `${frontendBaseUrl()}/?open=readiness-coach&googleClassroom=failed`;

  try {
    const result = await handleGoogleClassroomCallback({
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      error_description: req.query.error_description,
    });

    return res.status(200).send(
      googleCallbackHtml({
        success: true,
        title: "Google Classroom connected",
        message:
          result.message ||
          "Your Classroom connection was saved. You can now import deadlines.",
        redirectUrl: successRedirectUrl,
      })
    );
  } catch (error) {
    return res.status(error?.status || 500).send(
      googleCallbackHtml({
        success: false,
        title: "Google Classroom connection failed",
        message:
          "The OAuth callback reached your backend, but token save failed.",
        errorMessage: error.message || "Unknown OAuth error",
        redirectUrl: failedRedirectUrl,
      })
    );
  }
}

export async function googleImportHandler(req, res) {
  try {
    return ok(res, await importGoogleClassroom(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function scheduleSmsHandler(req, res) {
  try {
    return ok(res, await scheduleSms(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function smsWorkerRunHandler(req, res) {
  try {
    return ok(res, await runReadinessSmsWorkerOnce({ generate: false }));
  } catch (error) {
    return fail(res, error);
  }
}

export async function smsWebhookHandler(req, res) {
  try {
    return ok(res, await handleSmsReply(req.body));
  } catch (error) {
    return fail(res, error);
  }
}

export async function getPreferencesHandler(req, res) {
  try {
    return ok(res, await getReadinessPreferences(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function updatePreferencesHandler(req, res) {
  try {
    return ok(res, await upsertReadinessPreferences(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function getPlanningPreferencesHandler(req, res) {
  try {
    return ok(res, await getPlanningPreferences(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function updatePlanningPreferencesHandler(req, res) {
  try {
    return ok(res, await updatePlanningPreferences(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function generateDailyRemindersHandler(req, res) {
  try {
    return ok(res, await generateDailyReadinessReminders(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function generateHeavyWeekRemindersHandler(req, res) {
  try {
    return ok(res, await generateHeavyWeekReminders(withUser(req)), 201);
  } catch (error) {
    return fail(res, error);
  }
}

export async function reminderSchedulerRunHandler(req, res) {
  try {
    return ok(res, await runReadinessReminderSchedulerOnce(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function googleCalendarSyncHandler(req, res) {
  try {
    return ok(res, await syncReadinessToGoogleCalendar(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function voiceCoachTurnHandler(req, res) {
  try {
    return ok(res, await voiceCoachTurn(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function voiceConversationHandler(req, res) {
  try {
    return ok(res, await getVoiceConversation(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function offlineVoiceHealthHandler(req, res) {
  try {
    return ok(res, await offlineVoiceHealth());
  } catch (error) {
    return fail(res, error);
  }
}

export async function offlineVoiceSpeakHandler(req, res) {
  try {
    return ok(res, await offlineVoiceSpeak(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}

export async function offlineVoiceCheckinHandler(req, res) {
  try {
    return ok(res, await offlineVoiceCheckin(withUser(req), req.file || null));
  } catch (error) {
    return fail(res, error);
  }
}

export async function crossDeadlineRebalanceHandler(req, res) {
  try {
    return ok(res, await rebalanceAcrossDeadlines(withUser(req)));
  } catch (error) {
    return fail(res, error);
  }
}