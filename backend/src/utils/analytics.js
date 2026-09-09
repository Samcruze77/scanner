function logConversion(event, meta = {}) {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  console.log("[analytics]", JSON.stringify(payload));
}

module.exports = { logConversion };
