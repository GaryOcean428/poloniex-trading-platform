#!/bin/sh
# Git pre-commit hook for quality enforcement
# Run this script to install the pre-commit hook

set -e

HOOK_PATH=".git/hooks/pre-commit"

echo "🔧 Installing pre-commit hook..."

cat > "$HOOK_PATH" << 'EOF'
#!/bin/sh
# Git pre-commit hook for quality enforcement
# This hook runs linting, type checking, and tests before allowing commits

set -e

echo "🔍 Running pre-commit quality checks..."

# 1. Run ESLint
echo "📝 Running ESLint..."
if ! yarn lint; then
  echo "❌ ESLint failed. Please fix linting errors before committing."
  exit 1
fi

# 2. Run TypeScript compilation check  
echo "🔧 Running TypeScript check..."
if ! yarn workspace poloniex-frontend run tsc --noEmit; then
  echo "❌ TypeScript compilation failed in frontend. Please fix type errors."
  exit 1
fi

if ! yarn workspace poloniex-backend run tsc --noEmit; then
  echo "❌ TypeScript compilation failed in backend. Please fix type errors."  
  exit 1
fi

# 3. Run critical tests (skip slow integration tests in pre-commit)
echo "🧪 Running critical tests..."
if ! yarn test src/tests/advanced-backtesting.test.ts --run --reporter=basic; then
  echo "❌ Critical tests failed. Please fix failing tests before committing."
  exit 1
fi

# 4. Run security audit
echo "🔒 Running security audit..."
if ! yarn security:audit; then
  echo "❌ Security audit failed. Please address security issues."
  exit 1
fi

# 5. Check dependencies health  
echo "📦 Checking dependencies..."
if ! yarn deps:health; then
  echo "❌ Dependency health check failed."
  exit 1
fi

echo "✅ All pre-commit checks passed!"
EOF

chmod +x "$HOOK_PATH"

echo "✅ Pre-commit hook installed successfully!"
echo "📝 The hook will run quality checks on every commit."
echo "🚀 To bypass the hook (emergency only), use: git commit --no-verify"