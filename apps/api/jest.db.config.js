// The real-Postgres lane: `npm run test:db`. Needs DATABASE_URL to point at a database with the migrations applied
// (CI creates one; locally: create an empty database and run `npm run db:migrate` with DATABASE_URL set to it).
process.env.TEST_REAL_DB = 'true';

const base = require('./jest.config.js');

module.exports = {
  ...base,
  testRegex: '(-db|auth-expiry-queries)\\.e2e-spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/'],
};
