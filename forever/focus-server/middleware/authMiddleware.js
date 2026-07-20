import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";

function extractToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";

  if (String(header).startsWith("Bearer ")) {
    return String(header).slice(7).trim();
  }

  if (req.cookies?.token) return String(req.cookies.token).trim();
  if (req.query?.token) return String(req.query.token).trim();

  return "";
}

export default async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);

    if (
      !token ||
      token === "YOUR_TOKEN" ||
      token === "undefined" ||
      token === "null"
    ) {
      return res.status(401).json({
        msg: "No valid token provided. Please login again.",
        code: "token_missing",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.type && decoded.type !== "access") {
      return res.status(401).json({
        msg: "Invalid access token type. Please login again.",
        code: "token_invalid_type",
      });
    }

    const userId = decoded.id || decoded._id;

    if (!userId) {
      return res.status(401).json({
        msg: "Invalid token payload. Please login again.",
        code: "token_payload_invalid",
      });
    }

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(401).json({
        msg: "User not found. Please login again.",
        code: "user_not_found",
      });
    }

    req.user = user;
    req.auth = decoded;

    return next();
  } catch (error) {
    console.error("AUTH MIDDLEWARE ERROR:", error.message);

    return res.status(401).json({
      msg:
        error.name === "TokenExpiredError"
          ? "Token expired. Please login again."
          : "Invalid token signature. Please logout and login again.",
      code: error.name === "TokenExpiredError" ? "token_expired" : "token_invalid",
      detail: error.message,
    });
  }
}