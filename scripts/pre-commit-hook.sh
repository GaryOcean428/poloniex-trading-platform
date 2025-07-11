#!/bin/bash

# Pre-commit hook for code quality checks
set -e

echo "🔍 Running pre-commit quality checks..."

# Run ESLint
echo "📝 Running ESLint..."
if ! yarn lint; then
    echo "❌ ESLint failed. Please fix the issues above."
    exit 1
fi

# Run TypeScript check
echo "🔧 Running TypeScript check..."
if ! yarn workspace poloniex-frontend tsc --noEmit; then
    echo "❌ TypeScript check failed. Please fix the type errors above."
    exit 1
fi

# Run tests
echo "🧪 Running tests..."
if ! yarn test --run; then
    echo "❌ Tests failed. Please fix the failing tests above."
    exit 1
fi

# Run security audit
echo "🔒 Running security audit..."
if ! yarn security:audit; then
    echo "❌ Security audit failed. Please address security issues above."
    exit 1
fi

echo "✅ All pre-commit checks passed!"
exit 0