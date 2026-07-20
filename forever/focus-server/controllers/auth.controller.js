import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  process.env.JWT_SECRET ||
  "dev_refresh_secret_change_me";

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "60d";

function sanitizeUser(user) {
  if (!user) return null;

  return {
    _id: user._id,
    id: user._id,
    name: user.name || "",
    email: user.email || "",
    avatar: user.avatar || "",
    provider: user.provider || "local",
    googleId: user.googleId || "",
    role: user.role || "student",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function createAccessToken(user) {
  return jwt.sign(
    {
      id: String(user._id),
      _id: String(user._id),
      email: user.email,
      role: user.role || "student",
      type: "access",
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
    }
  );
}

function createRefreshToken(user) {
  return jwt.sign(
    {
      id: String(user._id),
      _id: String(user._id),
      email: user.email,
      type: "refresh",
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
    }
  );
}

function sendAuthResponse(res, user, status = 200, msg = "Success") {
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);

  return res.status(status).json({
    msg,
    token: accessToken,
    accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRES_IN,
    refreshExpiresIn: JWT_REFRESH_EXPIRES_IN,
    user: sanitizeUser(user),
  });
}

export const register = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body || {};

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ msg: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ msg: "Passwords do not match" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        msg: "Password must be at least 6 characters",
      });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(400).json({ msg: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      provider: "local",
      role: "student",
    });

    return sendAuthResponse(res, user, 201, "Registration successful");
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({
      msg: "Server error during registration",
      error: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        msg: "Email and password are required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    if (!user.password) {
      return res.status(400).json({
        msg: "This account uses Google sign-in. Continue with Google.",
      });
    }

    const matched = await bcrypt.compare(password, user.password);

    if (!matched) {
      return res.status(400).json({ msg: "Wrong password" });
    }

    return sendAuthResponse(res, user, 200, "Login successful");
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({
      msg: "Server error during login",
      error: error.message,
    });
  }
};

export const googleLogin = async (req, res) => {
  try {
    const { accessToken } = req.body || {};

    if (!accessToken) {
      return res.status(400).json({
        msg: "Google access token is required",
      });
    }

    const googleRes = await fetch("https://www.googleapis.com/userinfo/v2/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const googleUser = await googleRes.json();

    if (!googleRes.ok || !googleUser.email) {
      return res.status(401).json({ msg: "Invalid Google token" });
    }

    const cleanEmail = String(googleUser.email).trim().toLowerCase();

    let user = await User.findOne({ email: cleanEmail });

    if (!user) {
      user = await User.create({
        name: googleUser.name || "Google User",
        email: cleanEmail,
        avatar: googleUser.picture || "",
        googleId: googleUser.id || "",
        provider: "google",
        role: "student",
      });
    } else {
      user.name = googleUser.name || user.name;
      user.avatar = googleUser.picture || user.avatar || "";
      user.googleId = googleUser.id || user.googleId || "";
      user.provider = "google";
      await user.save();
    }

    return sendAuthResponse(res, user, 200, "Google login successful");
  } catch (error) {
    console.error("GOOGLE LOGIN ERROR:", error);
    return res.status(500).json({
      msg: "Server error during Google login",
      error: error.message,
    });
  }
};

export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
      return res.status(401).json({
        msg: "Refresh token is required",
        code: "refresh_token_missing",
      });
    }

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    if (decoded.type && decoded.type !== "refresh") {
      return res.status(401).json({
        msg: "Invalid refresh token type",
        code: "refresh_token_invalid_type",
      });
    }

    const userId = decoded.id || decoded._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({
        msg: "User not found",
        code: "user_not_found",
      });
    }

    return sendAuthResponse(res, user, 200, "Token refreshed");
  } catch (error) {
    console.error("REFRESH ERROR:", error.message);

    return res.status(401).json({
      msg: "Invalid or expired refresh token. Please login again.",
      code: "refresh_token_invalid",
      detail: error.message,
    });
  }
};

export const logout = async (req, res) => {
  return res.status(200).json({
    msg: "Logout successful",
  });
};

export const me = async (req, res) => {
  return res.status(200).json({
    user: sanitizeUser(req.user),
  });
};