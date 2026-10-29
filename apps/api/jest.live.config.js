// Live checks against real external services (`npm run check:ai`). Never part of `npm test` or CI.
const base = require('./jest.config.js');

module.exports = {
  ...base,
  testRegex: '\.live-spec\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
};
