import {
  askGoodContentQuestion,
  createGoodContentAnalysis,
  getGoodContentHealth,
  getGoodContentJob,
  listGoodContentJobs,
} from "../services/goodContentReach.service.js";

function ok(res, data = {}) {
  return res.json({
    ok: true,
    ...data,
  });
}

function fail(res, err, status = 500) {
  return res.status(status).json({
    ok: false,
    message: err?.message || "Request failed",
  });
}

export async function health(req, res) {
  try {
    return ok(res, getGoodContentHealth());
  } catch (err) {
    return fail(res, err);
  }
}

export async function analyze(req, res) {
  try {
    const job = await createGoodContentAnalysis(req.body || {});
    return ok(res, {
      job,
      jobId: job.jobId,
      message: "Good Content Reach analysis started.",
    });
  } catch (err) {
    return fail(res, err, 400);
  }
}

export async function getJob(req, res) {
  try {
    const data = await getGoodContentJob(req.params.jobId);
    return ok(res, data);
  } catch (err) {
    return fail(res, err, /not found/i.test(err.message) ? 404 : 400);
  }
}

export async function listJobs(req, res) {
  try {
    const jobs = await listGoodContentJobs(req.query || {});
    return ok(res, { jobs });
  } catch (err) {
    return fail(res, err);
  }
}

export async function askQuestion(req, res) {
  try {
    const answer = await askGoodContentQuestion(req.params.jobId, req.body || {});
    return ok(res, { answer });
  } catch (err) {
    return fail(res, err, 400);
  }
}