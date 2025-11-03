/**
 * Date Formatting Utility
 * Supports Australian (DD/MM/YYYY) and US (MM/DD/YYYY) date formats
 */

export type DateLocale = 'AU' | 'US';

// Default locale - can be changed via settings
let defaultLocale: DateLocale = 'AU';

/**
 * Set the default date locale
 */
export function setDateLocale(locale: DateLocale): void {
  defaultLocale = locale;
  if (typeof window !== 'undefined') {
    localStorage.setItem('dateLocale', locale);
  }
}

/**
 * Get the current date locale
 */
export function getDateLocale(): DateLocale {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('dateLocale') as DateLocale;
    if (stored) {
      defaultLocale = stored;
    }
  }
  return defaultLocale;
}

/**
 * Format date according to locale
 */
export function formatDate(date: Date | string | number, locale?: DateLocale): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  const loc = locale || getDateLocale();
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();

  return loc === 'AU' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
}

/**
 * Format date with time according to locale
 */
export function formatDateTime(date: Date | string | number, locale?: DateLocale): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  const loc = locale || getDateLocale();
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');

  const dateStr = loc === 'AU' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  return `${dateStr} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format date for display (short format)
 */
export function formatDateShort(date: Date | string | number, locale?: DateLocale): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  const loc = locale || getDateLocale();
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear().toString().slice(-2);

  return loc === 'AU' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
}

/**
 * Format time only
 */
export function formatTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return 'Invalid Time';
  }

  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    return formatDate(d);
  }
}

/**
 * Parse date string according to locale
 */
export function parseDate(dateStr: string, locale?: DateLocale): Date | null {
  const loc = locale || getDateLocale();
  const parts = dateStr.split('/');
  
  if (parts.length !== 3) {
    return null;
  }

  let day: number, month: number, year: number;

  if (loc === 'AU') {
    day = parseInt(parts[0]);
    month = parseInt(parts[1]) - 1; // JS months are 0-indexed
    year = parseInt(parts[2]);
  } else {
    month = parseInt(parts[0]) - 1;
    day = parseInt(parts[1]);
    year = parseInt(parts[2]);
  }

  const date = new Date(year, month, day);
  
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}
