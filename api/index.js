const { handler } = require("../lib/api-router");

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
