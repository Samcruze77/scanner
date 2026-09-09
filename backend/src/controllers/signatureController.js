const signatureService = require("../services/signatureService");

exports.save = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const signature = req.body.signature;
    const saved = await signatureService.saveSignature({ userId, signature });

    res.status(201).json({
      success: true,
      message: "Signature saved.",
      data: saved,
    });
  } catch (error) {
    next(error);
  }
};
