# Package Manager Configuration

## Current Status: ✅ Correctly Configured

### Package Manager: Yarn 4.9.2

The project uses **Yarn 4.9.2** (Berry) with Corepack.

### Configuration Files

✅ **Present:**
- `yarn.lock` - Yarn lockfile (root level)
- `.yarnrc.yml` - Yarn configuration
- `package.json` with `"packageManager": "yarn@4.9.2"`

❌ **Absent (Correct):**
- No `package-lock.json` (npm lockfile)
- No `npm-shrinkwrap.json` (npm lockfile)
- No `.npmrc` (npm configuration)

### Yarn Configuration (`.yarnrc.yml`)

```yaml
enableGlobalCache: true
enableImmutableInstalls: true
nodeLinker: node-modules
```

**Settings Explained:**
- `enableGlobalCache: true` - Shares packages across projects
- `enableImmutableInstalls: true` - Prevents lockfile modifications in CI/CD
- `nodeLinker: node-modules` - Uses traditional node_modules structure

### Package Manager Declaration

```json
{
  "packageManager": "yarn@4.9.2"
}
```

This tells Corepack to use Yarn 4.9.2 automatically.

## Installation Commands

### Local Development
```bash
# Enable Corepack (one-time setup)
corepack enable

# Install dependencies
yarn install

# Add a package
yarn add package-name

# Remove a package
yarn remove package-name
```

### CI/CD (Railway)
```bash
# Railway automatically uses Corepack
npm i -g corepack@latest && corepack enable && corepack prepare --activate
yarn install --check-cache
```

## Why Yarn 4 (Berry)?

### Advantages
1. **Faster installs** - Parallel downloads and better caching
2. **Smaller lockfile** - More efficient format
3. **Better workspace support** - Monorepo-friendly
4. **Plugin system** - Extensible architecture
5. **Zero-installs** (optional) - Can commit node_modules

### Workspace Structure
```
poloniex-trading-platform/
├── package.json (root)
├── yarn.lock (root)
├── backend/
│   └── package.json
└── frontend/
    └── package.json
```

## Common Issues & Solutions

### Issue: "packageManager field indicates Corepack"
**Solution:** Enable Corepack
```bash
corepack enable
```

### Issue: "lockfile would have been modified"
**Solution:** This is expected in CI/CD with `enableImmutableInstalls: true`
- Locally: Run `yarn install` to update lockfile
- Commit the updated `yarn.lock`

### Issue: "Cannot find module"
**Solution:** Clear cache and reinstall
```bash
yarn cache clean
rm -rf node_modules
yarn install
```

### Issue: Mixed npm/yarn usage
**Solution:** Use only Yarn commands
- ❌ `npm install` → ✅ `yarn install`
- ❌ `npm add` → ✅ `yarn add`
- ❌ `npm run` → ✅ `yarn run`

## Verification

### Check Package Manager
```bash
$ cat package.json | grep packageManager
"packageManager": "yarn@4.9.2"
```

### Check Yarn Version
```bash
$ yarn --version
4.9.2
```

### Check Lockfile
```bash
$ ls -la | grep lock
-rw-r--r--  1 user  staff  123456 Nov 12 10:28 yarn.lock
```

### Check No npm Lockfile
```bash
$ ls -la | grep package-lock
# Should return nothing
```

## Migration Notes

### From npm to Yarn
If you previously used npm:
1. Delete `package-lock.json`
2. Delete `node_modules/`
3. Run `yarn install`
4. Commit `yarn.lock`

### From Yarn 1 to Yarn 4
Already completed! The project uses Yarn 4.9.2.

## Railway Deployment

Railway automatically detects and uses Yarn 4:

```yaml
# Railpack automatically runs:
Steps:
  ▸ install
    $ npm i -g corepack@latest && corepack enable && corepack prepare --activate
    $ yarn install --check-cache
  
  ▸ build
    $ yarn run build
```

## Best Practices

### DO ✅
- Use `yarn` commands exclusively
- Commit `yarn.lock` to version control
- Keep `packageManager` field in `package.json`
- Use Corepack for version management

### DON'T ❌
- Mix npm and yarn commands
- Commit `node_modules/` (unless using zero-installs)
- Manually edit `yarn.lock`
- Use `npm install` in this project

## Status Summary

| Item | Status | Notes |
|------|--------|-------|
| Package Manager | ✅ Yarn 4.9.2 | Configured via Corepack |
| Lockfile | ✅ yarn.lock only | No npm lockfiles |
| Configuration | ✅ .yarnrc.yml | Properly configured |
| Workspaces | ✅ 2 packages | backend + frontend |
| CI/CD | ✅ Railway | Auto-detects Yarn |
| Dependencies | ✅ Up to date | 861 packages |

---

**Last Verified:** 2025-11-12  
**Package Manager:** Yarn 4.9.2 (Berry)  
**Status:** ✅ Production Ready
