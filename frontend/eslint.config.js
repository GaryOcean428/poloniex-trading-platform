import js from '@eslint/js';
import globals from 'globals';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
      globals: {
        ...Object.fromEntries(Object.entries(globals.browser).map(([k, v]) => [k.trim(), v])),
        React: 'readonly',
        chrome: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': plugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...plugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      'no-empty-pattern': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
];
