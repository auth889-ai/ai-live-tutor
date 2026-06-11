/** @type {import('jest').Config} */
const path = require("path");

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/*.test.js"],
  rootDir: ".",
  // Tests live in tests/server but dependencies (supertest, mongoose, bullmq
  // mocks' real counterparts) are installed in server/node_modules.
  moduleDirectories: [
    "node_modules",
    path.join(__dirname, "..", "..", "server", "node_modules"),
  ],
  moduleNameMapper: {},
  testTimeout: 15000,
  clearMocks: true,
  restoreMocks: true,
};
