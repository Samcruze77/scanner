const {
  savePushToken,
  updateNotificationSettings,
} = require("../services/pushNotificationService");

async function registerPushToken(req, res, next) {
  try {
    await savePushToken({
      userId: req.user.id,
      token: req.body.token,
      platform: req.body.platform,
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    await updateNotificationSettings({
      userId: req.user.id,
      enabled: req.body.enabled,
    });
    res.json({ success: true, data: { enabled: Boolean(req.body.enabled) } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  registerPushToken,
  updateSettings,
};
