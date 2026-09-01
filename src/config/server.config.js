const { PUBLIC_DIR } = require('../utils/paths');

module.exports = {
  port: process.env.PORT || 3000,
  publicDir: PUBLIC_DIR,
};
