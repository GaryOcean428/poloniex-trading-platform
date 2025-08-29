import js from '@eslint/js';
import globals from 'globals';
import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist', 'vite.config.ts', 'vitest.config.ts', 'tailwind.config.js', 'postcss.config.js'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        // Intentionally no 'project' to avoid type-aware parsing errors; use tsc for type checks
      },
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
      // TypeScript strict rules for quality improvement (warnings for now)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/prefer-as-const': 'warn',
      // Disabled because it requires type-aware linting, which we defer to tsc
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-const-assign': 'warn', // Change from error to warning
      'no-useless-catch': 'warn',

      // General code quality rules
      'no-undef': 'off',
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      'no-empty-pattern': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-var-requires': 'off', // Keep this off for compatibility
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-console': 'warn',
      'eqeqeq': ['warn', 'always'],
      // Additional QA rules
      'no-debugger': 'warn',
      'no-alert': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
    },
  },
  // Service/utility files are not React components; disable hook rules there
  {
    files: ['src/services/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
