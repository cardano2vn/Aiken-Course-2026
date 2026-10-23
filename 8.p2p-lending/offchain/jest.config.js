/** @type {import('ts-jest').JestConfigWithTsJest} **/

const jestConfig = {
    testTimeout: 60000,
    testEnvironment: "node",
    setupFiles: ["dotenv/config"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    transform: {
        "^.+.tsx?$": ["ts-jest", {}],
    },
};

export default jestConfig;
