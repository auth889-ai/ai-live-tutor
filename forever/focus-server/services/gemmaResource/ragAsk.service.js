// server/services/gemmaResource/ragAsk.service.js

import {
  runAskTutorGraph,
  runTutorBoardGraph,
  runBookGraph,
  runCodeDryRunGraph,
  runQuizGraph,
  runQuizAnswerGraph,
  getGemmaResourceMemoryGraph,
} from "./graphs/askTutor.graph.js";

function clean(value = "") {
  return String(value || "").trim();
}

function requestInput(req) {
  return {
    resourceId: req.params.resourceId || req.body?.resourceId || req.query?.resourceId || "",
    deviceId: clean(req.body?.deviceId || req.query?.deviceId || req.headers["x-device-id"] || ""),
    userId: clean(req.body?.userId || req.query?.userId || req.user?.id || req.user?._id || ""),
    question: clean(req.body?.question || req.body?.message || req.query?.question || ""),
    mode: clean(req.body?.mode || req.query?.mode || ""),
    language: clean(req.body?.language || req.query?.language || ""),
    limit: Number(req.body?.limit || req.query?.limit || 8),
    studentAnswer: clean(req.body?.studentAnswer || req.body?.answer || ""),
    quizQuestion: clean(req.body?.quizQuestion || req.body?.question || ""),
  };
}

function sendOk(res, data) {
  return res.json({
    ok: true,
    data,
  });
}

function sendError(res, error, fallback = "Gemma Resource request failed.") {
  const message = error?.message || fallback;

  const status =
    /not found/i.test(message)
      ? 404
      : /invalid|required|not ready|no saved/i.test(message)
        ? 400
        : 500;

  return res.status(status).json({
    ok: false,
    message,
  });
}

export async function answerGemmaResourceQuestion(input = {}) {
  return runAskTutorGraph(input);
}

export async function generateTutorBoard(input = {}) {
  return runTutorBoardGraph(input);
}

export async function generateFlipBook(input = {}) {
  return runBookGraph(input);
}

export async function generateCodeDryRun(input = {}) {
  return runCodeDryRunGraph(input);
}

export async function generateQuiz(input = {}) {
  return runQuizGraph(input);
}

export async function answerQuizQuestion(input = {}) {
  return runQuizAnswerGraph(input);
}

export async function getGemmaResourceMemory(input = {}) {
  return getGemmaResourceMemoryGraph(input);
}

export async function handleAskGemmaResource(req, res) {
  try {
    const data = await answerGemmaResourceQuestion(requestInput(req));
    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceAsk]", error);
    return sendError(res, error, "Ask Gemma failed.");
  }
}

export async function handleTutorBoard(req, res) {
  try {
    const data = await generateTutorBoard(requestInput(req));
    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceTutorBoard]", error);
    return sendError(res, error, "Tutor board failed.");
  }
}

export async function handleFlipBook(req, res) {
  try {
    const data = await generateFlipBook(requestInput(req));
    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceBook]", error);
    return sendError(res, error, "Study book failed.");
  }
}

export async function handleCodeDryRun(req, res) {
  try {
    const data = await generateCodeDryRun(requestInput(req));
    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceCodeDryRun]", error);
    return sendError(res, error, "Code dry run failed.");
  }
}

export async function handleQuiz(req, res) {
  try {
    const data = await generateQuiz(requestInput(req));
    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceQuiz]", error);
    return sendError(res, error, "Quiz generation failed.");
  }
}

export async function handleQuizAnswer(req, res) {
  try {
    const input = requestInput(req);

    const data = await answerQuizQuestion({
      ...input,
      question: input.quizQuestion || input.question,
      studentAnswer: input.studentAnswer,
    });

    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceQuizAnswer]", error);
    return sendError(res, error, "Quiz answer review failed.");
  }
}

export async function handleMemory(req, res) {
  try {
    const data = await getGemmaResourceMemory({
      deviceId: clean(req.params.deviceId || req.query.deviceId || req.body?.deviceId || ""),
      resourceId: clean(req.query.resourceId || req.body?.resourceId || ""),
    });

    return sendOk(res, data);
  } catch (error) {
    console.error("[GemmaResourceMemory]", error);
    return sendError(res, error, "Memory loading failed.");
  }
}