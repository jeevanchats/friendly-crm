module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Specs that need a real, migrated Postgres run in their own lane (jest.db.config.js, `npm run test:db`)
  testRegex: '.*\\.e2e-spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '(-db|auth-expiry-queries)\\.e2e-spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@friendly-crm/db$': '<rootDir>/../../packages/db/src',
    '^@friendly-crm/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@friendly-crm/shared$': '<rootDir>/../../packages/shared/src',
    '^@friendly-crm/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
  testEnvironment: 'node',
  // Generating a PDF takes a fraction of a second; on a busy machine the 5 s default turned slowness into a failure
  testTimeout: 20000,
};
