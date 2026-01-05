const { validationResult } = require('express-validator')
const _ = require("lodash")
const controller = (service) => {
  return async (req, res, _next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array() })
    }
    try {
      const response = await service({
        headers: req.headers,
        cookies: req.cookies,
        body: req.body,
        file: req.file ?? null,
        files: req.files ?? [],
        query: req.query,
        params: req.params,
        user: req.user,
        res,
      });
      res.status(200).json(response);
    } catch (error) {
      console.log('[ERROR]', error);
      res
        .status(error.status ?? 500)
        .json({ message: error.message ?? "Something went wrong" });
      console.log(error);
    }
  };
};

module.exports = controller;