# GitHub Actions CI/CD

This directory contains GitHub Actions workflows for automated continuous integration and deployment.

## Workflows

### `ci-types.yml` - TypeScript Type Safety Check

**Purpose**: Automated TypeScript type checking and code quality validation on pull requests.

**Triggers**:
- Pull requests to `main` and `develop` branches
- Only when TypeScript, JavaScript, or configuration files change

**Jobs**:

1. **`type-check`** - TypeScript Compilation Validation
   - ✅ **Backend**: Strict TypeScript checking (`yarn workspace backend tsc --noEmit`)
   - ⚠️  **Frontend**: Informational TypeScript checking (continues on error)
   - **Node.js**: 20.x (aligned with project requirements)
   - **Package Manager**: Yarn 4.9.2 with Corepack

2. **`lint-check`** - Code Quality Validation
   - ESLint validation for both backend and frontend
   - Continues on error to show all issues
   - Runs after type checking completes

3. **`security-audit`** - Security Validation
   - Dependency vulnerability scanning with `yarn audit`
   - Custom security checks via `yarn security:audit`
   - License compliance checking
   - Hardcoded secrets detection

**Key Features**:
- **Fast Failure**: Backend TypeScript errors block the pipeline
- **Informational Checks**: Frontend TypeScript and lint errors are shown but don't block
- **Security Focus**: Automated security scanning on every PR
- **Yarn Workspace Support**: Proper monorepo handling
- **Path-based Optimization**: Only runs when relevant files change

## Security Benefits

### Pull Request Protection
- **Type Safety**: Prevents deployment of code with backend TypeScript errors
- **Code Quality**: Enforces consistent linting standards
- **Vulnerability Detection**: Automatic security audit on code changes
- **Dependency Safety**: Monitors for vulnerable dependencies

### Compliance Features
- **Environment Variable Validation**: Ensures no hardcoded secrets
- **License Compliance**: Validates dependency licenses
- **Security Policy Alignment**: Automated checks align with project security policies

## Configuration Files

The workflow is triggered by changes to:
- `backend/**/*.ts` - Backend TypeScript files
- `frontend/**/*.tsx` - Frontend TypeScript/React files
- `**/package.json` - Package dependency files
- `**/tsconfig.json` - TypeScript configuration files
- `yarn.lock` - Dependency lock file

## Usage

The workflow runs automatically on pull requests. To manually test the commands locally:

```bash
# Backend TypeScript check (must pass)
yarn workspace backend tsc --noEmit

# Frontend TypeScript check (informational)
yarn workspace frontend tsc --noEmit

# Lint checks
yarn workspace backend lint
yarn workspace frontend lint

# Security audit
yarn security:audit
```

## Integration with Railway Deployment

This CI workflow ensures code quality before deployment to Railway:
- Backend TypeScript errors prevent merging (and thus deployment)
- Security vulnerabilities are detected before reaching production
- Code quality standards are maintained across the codebase
- Environment variable security is validated

The workflow complements the Railway deployment pipeline documented in `RAILWAY_DEPLOYMENT_FIX_SUMMARY.md`.
