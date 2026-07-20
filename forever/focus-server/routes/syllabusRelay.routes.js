import express from "express";
import * as controller from "../controllers/syllabusRelay.controller.js";

const router = express.Router();

router.get("/health", controller.health);

router.post("/courses", controller.createCourse);
router.get("/courses", controller.listCourses);
router.get("/courses/:courseId", controller.getCourse);

router.post(
  "/courses/:courseId/upload",
  controller.uploadSyllabusMiddleware,
  controller.uploadDocument
);

router.post("/documents/:documentId/parse", controller.parseDocument);
router.get("/documents/:documentId/draft", controller.getDraft);

router.patch("/drafts/:draftId/events/:eventId", controller.updateDraftEvent);
router.delete("/drafts/:draftId/events/:eventId", controller.deleteDraftEvent);
router.post("/drafts/:draftId/events", controller.addDraftEvent);
router.post("/drafts/:draftId/confirm", controller.confirmDraft);

router.post("/courses/:courseId/generate-calendar", controller.generateCalendar);
router.get("/courses/:courseId/calendar", controller.getCalendar);
router.get("/courses/:courseId/tasks", controller.getTasks);
router.get("/courses/:courseId/export.ics", controller.exportIcs);

router.post("/courses/:courseId/publish", controller.publishCourse);
router.get("/public/search", controller.searchPublic);
router.get("/public/:publicId", controller.getPublic);
router.get("/public/:publicId/download.ics", controller.downloadPublicIcs);
router.post("/public/:publicId/vouch", controller.vouchPublic);
router.patch("/public/:publicId/events/:eventId", controller.editPublicEvent);

router.post("/courses/:courseId/google/sync", controller.googleSync);
router.post(
  "/courses/:courseId/drive/create-folders",
  controller.driveCreateFolders
);
router.post("/courses/:courseId/sms/schedule", controller.smsSchedule);

export default router;