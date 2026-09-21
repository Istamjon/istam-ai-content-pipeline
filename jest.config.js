export default {
  preset: "ts-jest/presets/default-esm",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: [".ts"],
  setupFiles: ["dotenv/config"],
  // No `passWithNoTests`: if the unit suite ever disappears, CI must go red
  // instead of staying green. The integration script opts in explicitly.
  testTimeout: 20_000,
};
