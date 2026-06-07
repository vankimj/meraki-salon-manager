// Mobile lint — focused on crash-class bugs the build/parse-check can't catch:
//   • react-hooks/rules-of-hooks: a hook called conditionally / after an early
//     return throws "rendered more hooks than the previous render" at runtime
//     (hit on the Earnings tab 2026-06-07). ERROR — fails the gate.
//   • no-undef: referencing an undefined identifier (missing import / scope bug)
//     ships green from `vite build` but red-screens on device. ERROR.
// exhaustive-deps + unused-vars are advisory (warn) — informational, never fail.
//
// Run: `npm run lint` (or `npm run lint:fix`). Run before every eas build / eas
// update — see project_mobile_pitfalls + project_deploy_workflow in memory.
import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'ios/**', 'android/**', '.expo/**', 'dist/**'],
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ['babel-preset-expo'] },
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,   // fetch, URL, setTimeout, console, FormData, …
        ...globals.node,      // require, module, process, __dirname, …
        __DEV__: 'readonly',  // React Native
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
];
