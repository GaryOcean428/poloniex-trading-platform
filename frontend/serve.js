/**
 * Compatibility wrapper for Railway deployment.
 *
 * The frontend app lives at apps/web/. This thin re-export ensures that
 * Railway service settings referencing the legacy "frontend/serve.js" path
 * continue to work without requiring a dashboard change.
 *
 * import.meta.url inside apps/web/serve.js still resolves to its own
 * location, so all __dirname / DIST_ROOT calculations remain correct.
 */
import '../apps/web/serve.js';
