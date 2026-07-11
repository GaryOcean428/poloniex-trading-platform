import { logger } from './logger.js';

let lastHeapUsed = 0;
let lastCheckTime = Date.now();

export function startMemoryMonitoring(): void {
  if (process.env.NODE_ENV !== 'production') return;

  setInterval(() => {
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const heapUsedPercent = (mem.heapUsed / mem.heapTotal) * 100;
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    const now = Date.now();
    const timeDeltaMin = (now - lastCheckTime) / 60000;
    const heapDeltaMB = heapUsedMB - lastHeapUsed;
    const growthRateMBPerMin = timeDeltaMin > 0 ? heapDeltaMB / timeDeltaMin : 0;

    logger.info('💾 Memory snapshot', {
      heapUsedMB,
      heapTotalMB,
      heapUsedPercent: heapUsedPercent.toFixed(1),
      rssMB,
      growthRateMBPerMin: growthRateMBPerMin.toFixed(2),
    });

    if (heapUsedPercent > 80) {
      logger.warn('⚠️  HEAP WARNING: Memory usage exceeds 80%', {
        heapUsedMB,
        heapTotalMB,
        heapUsedPercent: heapUsedPercent.toFixed(1),
        rssMB,
        growthRateMBPerMin: growthRateMBPerMin.toFixed(2),
      });
    }

    lastHeapUsed = heapUsedMB;
    lastCheckTime = now;
  }, 60000);
}
