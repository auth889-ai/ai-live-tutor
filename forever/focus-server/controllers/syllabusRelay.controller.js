import multer from "multer";
import path from "path";
import fs from "fs";
import * as service from "../services/syllabusRelay.service.js";

const uploadDir = path.join(process.cwd(), "uploads", "syllabus-relay");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const safe = String(file.originalname || "syllabus")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-140);

    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${safe}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize:
      Number(process.env.SYLLABUS_RELAY_MAX_FILE_MB || 30) * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();

    if (
      mime.includes("pdf") ||
      mime.includes("word") ||
      mime.includes("text") ||
      [".pdf", ".docx", ".txt"].includes(ext)
    ) {
      return cb(null, true);
    }

    cb(new Error("Only PDF, DOCX, or TXT syllabus files are allowed."));
  },
});

export const uploadSyllabusMiddleware = upload.single("syllabus");

function readUserId(req) {
  return (
    req.body?.userId ||
    req.query?.userId ||
    req.headers["x-user-id"] ||
    req.user?.id ||
    req.user?._id ||
    ""
  );
}

function readUserEmail(req) {
  return (
    req.body?.userEmail ||
    req.body?.email ||
    req.query?.userEmail ||
    req.headers["x-user-email"] ||
    req.user?.email ||
    ""
  );
}

function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, error, status = 400) {
  console.error("[syllabus-relay controller]", error);

  return res.status(status).json({
    ok: false,
    message: error?.message || "Syllabus Relay request failed.",
  });
}

export async function health(req, res) {
  try {
    return ok(res, await service.health());
  } catch (error) {
    return fail(res, error, 500);
  }
}

export async function createCourse(req, res) {
  try {
    return ok(
      res,
      await service.createCourse({
        ...req.body,
        userId: readUserId(req),
        userEmail: readUserEmail(req),
      }),
      201
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function listCourses(req, res) {
  try {
    return ok(
      res,
      await service.listCourses({
        userId: readUserId(req),
        q: req.query.q,
        limit: req.query.limit,
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function getCourse(req, res) {
  try {
    return ok(res, await service.getCourse(req.params.courseId));
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function uploadDocument(req, res) {
  try {
    return ok(
      res,
      await service.uploadDocument({
        courseId: req.params.courseId,
        userId: readUserId(req),
        file: req.file,
        text: req.body?.text,
      }),
      201
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function parseDocument(req, res) {
  try {
    return ok(
      res,
      await service.parseDocument({
        documentId: req.params.documentId,
        userId: readUserId(req),
      }),
      201
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function getDraft(req, res) {
  try {
    return ok(res, await service.getDraft(req.params.documentId));
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function updateDraftEvent(req, res) {
  try {
    return ok(
      res,
      await service.updateDraftEvent({
        draftId: req.params.draftId,
        eventId: req.params.eventId,
        patch: req.body,
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function deleteDraftEvent(req, res) {
  try {
    return ok(
      res,
      await service.deleteDraftEvent({
        draftId: req.params.draftId,
        eventId: req.params.eventId,
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function addDraftEvent(req, res) {
  try {
    return ok(
      res,
      await service.addDraftEvent({
        draftId: req.params.draftId,
        event: req.body,
      }),
      201
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function confirmDraft(req, res) {
  try {
    return ok(
      res,
      await service.confirmDraft({
        draftId: req.params.draftId,
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function generateCalendar(req, res) {
  try {
    return ok(
      res,
      await service.generateCalendar({
        courseId: req.params.courseId,
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function getCalendar(req, res) {
  try {
    return ok(res, await service.getCalendar(req.params.courseId));
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function getTasks(req, res) {
  try {
    return ok(res, await service.getTasks(req.params.courseId));
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function exportIcs(req, res) {
  try {
    const result = await service.exportIcs(req.params.courseId);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );

    return res.send(result.icsText);
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function publishCourse(req, res) {
  try {
    return ok(
      res,
      await service.publishCourse({
        courseId: req.params.courseId,
        userId: readUserId(req),
      }),
      201
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function searchPublic(req, res) {
  try {
    return ok(
      res,
      await service.searchPublic({
        q: req.query.q,
        limit: req.query.limit,
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function getPublic(req, res) {
  try {
    return ok(res, await service.getPublic(req.params.publicId));
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function downloadPublicIcs(req, res) {
  try {
    const result = await service.downloadPublicIcs(req.params.publicId);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );

    return res.send(result.icsText);
  } catch (error) {
    return fail(res, error, 404);
  }
}

export async function vouchPublic(req, res) {
  try {
    return ok(
      res,
      await service.vouchPublic({
        publicId: req.params.publicId,
        userId: readUserId(req),
        userEmail: readUserEmail(req),
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function editPublicEvent(req, res) {
  try {
    return ok(
      res,
      await service.editPublicEvent({
        publicId: req.params.publicId,
        eventId: req.params.eventId,
        patch: req.body,
        editor: {
          userId: readUserId(req),
          userEmail: readUserEmail(req),
        },
      })
    );
  } catch (error) {
    return fail(res, error);
  }
}

export async function googleSync(req, res) {
  try {
    const result = await service.googleSync({
      courseId: req.params.courseId,
      userId: readUserId(req),
    });

    return res
      .status(result.ok === false ? 501 : 200)
      .json(result.ok === false ? result : { ok: true, data: result });
  } catch (error) {
    return fail(res, error);
  }
}

export async function driveCreateFolders(req, res) {
  try {
    const result = await service.driveCreateFolders({
      courseId: req.params.courseId,
      userId: readUserId(req),
    });

    return res
      .status(result.ok === false ? 501 : 200)
      .json(result.ok === false ? result : { ok: true, data: result });
  } catch (error) {
    return fail(res, error);
  }
}

export async function smsSchedule(req, res) {
  try {
    const result = await service.smsSchedule({
      courseId: req.params.courseId,
      userId: readUserId(req),
    });

    return res
      .status(result.ok === false ? 501 : 200)
      .json(result.ok === false ? result : { ok: true, data: result });
  } catch (error) {
    return fail(res, error);
  }
}