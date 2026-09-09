function setConversionType(type) {
  return (req, _res, next) => {
    req.conversionType = type;
    next();
  };
}

module.exports = setConversionType;
