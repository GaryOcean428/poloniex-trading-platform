# Required Railway Environment Variables

## Frontend Service (polytrade-fe)

Add this environment variable in Railway dashboard:

```
RAILPACK_PACKAGES=caddy
```

This will install Caddy via Mise for serving the static frontend.

## ML Worker Service (ml-worker)

No additional environment variables needed for Railpack.
Python and uv will be auto-detected from pyproject.toml and uv.lock.

## Backend Service (polytrade-be)

No additional Railpack environment variables needed.
Node and Yarn will be auto-detected.

---

## How to Add Environment Variables in Railway

1. Go to Railway Dashboard
2. Select your project
3. Click on the service (e.g., polytrade-fe)
4. Go to "Variables" tab
5. Click "New Variable"
6. Add: `RAILPACK_PACKAGES` = `caddy`
7. Click "Add"
8. Redeploy the service

---

## Reference

- [Railpack Installing Packages](https://railpack.com/guides/installing-packages)
- [Mise Registry - Caddy](https://mise.jdx.dev/registry.html)
