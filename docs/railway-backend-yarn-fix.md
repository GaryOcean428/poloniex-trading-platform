# Railway Backend (polytrade-be) Yarn Configuration Fix

## Issue
Railway UI is overriding the `railpack.json` configuration and running `npm install` and `npm run build` instead of using Yarn 4.9.2 as specified.

## Solution Steps

### Step 1: Access Railway Dashboard
1. Go to Railway Dashboard
2. Navigate to **Services** → **Backend (polytrade-be)**
3. Click on **Settings** tab
4. Scroll to **Build & Deploy** section

### Step 2: Clear Override Fields (Preferred Method)
In the Build & Deploy section, **completely clear** (leave blank) these fields:
- **Install Command**: Leave blank (delete any text)
- **Build Command**: Leave blank (delete any text)
- **Watch Paths**: Leave blank (delete any text)

**Important**: Don't just delete the text - ensure the fields are completely empty with no spaces.

### Step 3: Save and Redeploy
1. Click **Save** to apply changes
2. Go to **Deployments** tab
3. Click **Redeploy** or trigger a new deployment

### Alternative: Explicit Commands (If Clearing Doesn't Work)
If Railway continues to use npm after clearing the fields, explicitly set:

- **Install Command**: 
  ```bash
  corepack enable; corepack prepare yarn@4.9.2 --activate; yarn --cwd .. install --check-cache
  ```

- **Build Command**:
  ```bash
  yarn run build
  ```

## Verification

### Check Deployment Logs
After redeployment, verify in the logs that you see:

✅ **Correct output:**
```bash
$ yarn --cwd .. install --check-cache
...
$ yarn run build
```

❌ **Incorrect output (should NOT appear):**
```bash
$ npm install
$ npm run build
```

## Root Cause
Railway UI build settings override `railpack.json` configuration when fields are populated. The `railpack.json` file in the backend directory already specifies:
- Node version: 20
- Yarn version: 4.9.2
- Install command: `yarn install --check-cache`
- Build command: `yarn run build`

By clearing the UI fields, Railway should respect the `railpack.json` configuration.

## Additional Notes
- The backend service is located at `./backend` relative to the repository root
- The project uses Yarn 4.9.2 with PnP disabled (`nodeLinker: node-modules`)
- There's a monorepo `railpack.json` at the root that defines the service structure
