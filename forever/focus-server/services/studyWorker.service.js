import { getStudyJob, listStudyJobs } from "./studyQueue.service.js";

export function getStudyWorkerStatus() {
  return {
    ok: true,
    type: "in-memory",
    message: "Study worker is using lightweight in-memory queue.",
    recentJobs: listStudyJobs({ limit: 20 }),
  };
}

export function getStudyWorkerJob(jobId) {
  return getStudyJob(jobId);
}