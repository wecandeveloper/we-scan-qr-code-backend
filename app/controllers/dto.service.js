const returnError = (status, message) => {
  return {
    status,
    message,
  };
};
module.exports = returnError