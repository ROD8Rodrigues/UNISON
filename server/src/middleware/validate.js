'use strict';

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const input = source === 'query' ? req.query : source === 'params' ? req.params : req.body;
    const result = schema.safeParse(input);
    if (!result.success) return next(result.error);
    req.validated = req.validated || {};
    req.validated[source] = result.data;
    if (source === 'body') req.body = result.data;
    next();
  };
}

module.exports = { validate };
