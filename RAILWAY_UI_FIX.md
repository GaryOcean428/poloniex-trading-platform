# ⚠️ URGENT: Railway UI Override Fix Required

## The Problem
Your backend service is **failing** because Railway UI is using `npm` instead of `yarn`, causing TypeScript compilation errors with shared types.

## Immediate Fix Required

### Go to Railway Dashboard → Backend Service (polytrade-be)

1. Navigate to **Settings → Build & Deploy**

2. **CLEAR THESE FIELDS COMPLETELY** (make them blank):
   - ❌ Build Command: **DELETE ANY TEXT HERE**
   - ❌ Install Command: **DELETE ANY TEXT HERE**
   - ❌ Watch Paths: **DELETE ANY TEXT HERE**

3. **Save Changes**

4. **Redeploy** the service

## Why This Is Happening

Railway UI settings **override** railpack.json configurations. Your logs show:
- ❌ Using: `npm install` and `npm run build`
- ✅ Should use: `yarn install --check-cache` and `yarn run build`

## Alternative If Clearing Doesn't Work

If clearing the fields doesn't work, explicitly set:
- Install Command: `yarn install --check-cache`
- Build Command: `yarn run build`

## Verification

After fixing, your build logs should show:
```
Steps
──────────
▸ install
$ yarn install --check-cache  ← THIS

▸ build
$ yarn run build  ← THIS
```

NOT:
```
▸ install
$ npm install  ← WRONG!

▸ build
$ npm run build  ← WRONG!
```

## Quick Links
- Railway Dashboard: https://railway.app/dashboard
- Service ID: e473a919-acf9-458b-ade3-82119e4fabf6
