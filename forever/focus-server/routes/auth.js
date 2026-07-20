import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  register,
  login,
  googleLogin,
  refresh,
  logout,
  me,
} from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", authMiddleware, me);

export default router;