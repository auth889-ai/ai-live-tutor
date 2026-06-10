/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/*.test.js"],
  rootDir: ".",
  moduleNameMapper: {},
  setupFilesAfterFramework: [],
  testTimeout: 15000,
  clearMocks: true,
  restoreMocks: true,
};
