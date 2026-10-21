module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
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
};
