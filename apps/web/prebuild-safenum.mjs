/**
 * Pre-build script: wraps all .toFixed() calls in agent components with safeNum()
 * to prevent "Cannot read properties of undefined (reading 'toFixed')" crashes.
 *
 * Run before vite build via: node apps/web/prebuild-safenum.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(__dirname, 'src', 'components', 'agent');
const IMPORT_LINE = "import { safeNum } from '@/utils/safeNum';";

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('.toFixed(')) return 0;

  // Add import if not present
  if (!content.includes('safeNum')) {
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith('import ')) lastImportIdx = i;
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, IMPORT_LINE);
      content = lines.join('\n');
    }
  }

  let count = 0;

  // Wrap property.toFixed( patterns that aren't already wrapped
  // Match: word.word.toFixed( but NOT safeNum(...).toFixed( or (x || 0).toFixed(
  content = content.replace(
    /(?<!safeNum\([^)]*?)(?<!\|\| 0\))(?<!\?\? 0\))(?<!safeNum\()([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*(?:\?\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*\.toFixed\(/g,
    (match, expr) => {
      if (expr === 'safeNum' || match.includes('safeNum(')) return match;
      count++;
      return `safeNum(${expr}).toFixed(`;
    }
  );

  // Also wrap Math.abs(x).toFixed( → safeNum(Math.abs(x)).toFixed(
  content = content.replace(
    /(?<!safeNum\()Math\.abs\(([^)]+)\)\.toFixed\(/g,
    (match, inner) => {
      count++;
      return `safeNum(Math.abs(${inner})).toFixed(`;
    }
  );

  // Also wrap (expr / expr).toFixed( → safeNum(expr / expr).toFixed(
  content = content.replace(
    /(?<!safeNum)\(([^)]+)\)\.toFixed\(/g,
    (match, inner) => {
      if (inner.includes('|| 0') || inner.includes('?? 0') || inner.includes('safeNum')) return match;
      count++;
      return `safeNum(${inner}).toFixed(`;
    }
  );

  if (count > 0) {
    fs.writeFileSync(filePath, content);
  }
  return count;
}

let totalFixed = 0;
const files = fs.readdirSync(AGENT_DIR).filter(f => f.endsWith('.tsx'));

for (const file of files) {
  const filePath = path.join(AGENT_DIR, file);
  const fixed = processFile(filePath);
  if (fixed > 0) {
    console.log(`  ${file}: wrapped ${fixed} .toFixed() calls`);
    totalFixed += fixed;
  }
}

console.log(`\nsafeNum prebuild: ${totalFixed} .toFixed() calls wrapped across ${files.length} files`);
