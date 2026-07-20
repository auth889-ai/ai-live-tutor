const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar || "",
  provider: user.provider || "local",
  googleId: user.googleId || "",
  role: user.role || "student",
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const getProfile = async (req, res) => {
  return res.status(200).json({
    user: sanitizeUser(req.user),
  });
};

export const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;

    if (name !== undefined) {
      req.user.name = String(name).trim();
    }

    if (avatar !== undefined) {
      req.user.avatar = String(avatar).trim();
    }

    await req.user.save();

    return res.status(200).json({
      msg: "Profile updated",
      user: sanitizeUser(req.user),
    });
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);
    return res.status(500).json({ msg: "Profile update failed" });
  }
};