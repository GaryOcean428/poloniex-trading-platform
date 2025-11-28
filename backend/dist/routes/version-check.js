import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * GET /api/version-check
 * Returns information about the deployed code version
 */
router.get('/', async (req, res) => {
    try {
        // Read the userService.js file to check if permissions column is removed
        const userServicePath = path.join(__dirname, '../services/userService.js');
        const userServiceContent = fs.readFileSync(userServicePath, 'utf8');
        // Check if permissions column exists in SELECT queries
        const hasPermissionsInSelect = userServiceContent.includes('permissions,') ||
            userServiceContent.includes('permissions ') &&
                userServiceContent.includes('FROM api_credentials');
        // Extract the getApiCredentials SELECT query
        const selectQueryMatch = userServiceContent.match(/getApiCredentials\(userId[^}]+?SELECT[\s\S]+?FROM api_credentials[\s\S]+?WHERE/);
        const selectQuery = selectQueryMatch ? selectQueryMatch[0].substring(0, 500) : 'Not found';
        res.json({
            success: true,
            deployedAt: new Date().toISOString(),
            codeVersion: {
                hasPermissionsColumnInSelect: hasPermissionsInSelect,
                selectQueryPreview: selectQuery,
                fileSize: userServiceContent.length,
                linesCount: userServiceContent.split('\n').length
            },
            environment: process.env.NODE_ENV || 'development',
            nodeVersion: process.version,
            message: hasPermissionsInSelect ?
                '⚠️ OLD CODE DEPLOYED - permissions column still in SELECT' :
                '✅ NEW CODE DEPLOYED - permissions column removed'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});
export default router;
