/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  },
  // .venv bundles JupyterLab's own static/staging assets, and the labextension
  // build output duplicates this package's own package.json -- both otherwise
  // trip jest-haste-map's module-naming-collision warning.
  modulePathIgnorePatterns: ['<rootDir>/.venv/', '<rootDir>/jupyterlab_markus_extension/labextension/']
};
