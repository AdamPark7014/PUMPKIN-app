/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  ignorePatterns: ['.next/**', 'node_modules/**', 'out/**', 'coverage/**'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@next/next', 'react-hooks'],
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  // Register next/react-hooks rules so existing eslint-disable comments resolve,
  // without enforcing a rewrite of storefront features.
  rules: {
    '@next/next/no-img-element': 'off',
    '@next/next/no-html-link-for-pages': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-hooks/rules-of-hooks': 'off',
  },
};
