/** Jest config scoped to ai-engine unit tests (pure algorithms). */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          skipLibCheck: true,
          paths: {
            '@boletera/shared': ['../../../../../packages/shared/src/index.ts'],
          },
        },
        isolatedModules: true,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@boletera/shared$': '<rootDir>/../../../../../packages/shared/src/index.ts',
  },
};
