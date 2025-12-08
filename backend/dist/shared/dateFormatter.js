/**
 * Date Formatter Utility
 * Supports both Australian (DD/MM/YYYY) and US (MM/DD/YYYY) date formats
 */
/**
 * Format a date according to the specified locale format
 * @param date - Date to format (Date object, ISO string, or timestamp)
 * @param options - Formatting options
 * @returns Formatted date string
 */
export function formatDate(date, options = {}) {
    const { format = 'AU', // Default to Australian format
    includeTime = false, includeSeconds = false, use24Hour = true } = options;
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) {
        return 'Invalid Date';
    }
    const day = dateObj.getDate().toString().padStart(2, '0');
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const year = dateObj.getFullYear();
    // Format date part based on locale
    const datePart = format === 'AU'
        ? `${day}/${month}/${year}` // Australian: DD/MM/YYYY
        : `${month}/${day}/${year}`; // US: MM/DD/YYYY
    if (!includeTime) {
        return datePart;
    }
    // Format time part
    let hours = dateObj.getHours();
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const seconds = dateObj.getSeconds().toString().padStart(2, '0');
    let timePart = '';
    if (use24Hour) {
        const hoursStr = hours.toString().padStart(2, '0');
        timePart = includeSeconds
            ? `${hoursStr}:${minutes}:${seconds}`
            : `${hoursStr}:${minutes}`;
    }
    else {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const hoursStr = hours.toString().padStart(2, '0');
        timePart = includeSeconds
            ? `${hoursStr}:${minutes}:${seconds} ${ampm}`
            : `${hoursStr}:${minutes} ${ampm}`;
    }
    return `${datePart} ${timePart}`;
}
/**
 * Format a date for transaction history
 */
export function formatTransactionDate(date, format = 'AU') {
    return formatDate(date, {
        format,
        includeTime: true,
        includeSeconds: true,
        use24Hour: true
    });
}
/**
 * Format a date for chart labels (short format)
 */
export function formatChartDate(date, format = 'AU') {
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) {
        return 'Invalid';
    }
    const day = dateObj.getDate().toString().padStart(2, '0');
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const hours = dateObj.getHours().toString().padStart(2, '0');
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    // Chart format: DD/MM HH:mm or MM/DD HH:mm
    return format === 'AU'
        ? `${day}/${month} ${hours}:${minutes}`
        : `${month}/${day} ${hours}:${minutes}`;
}
/**
 * Format a date for reports (detailed format)
 */
export function formatReportDate(date, format = 'AU') {
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) {
        return 'Invalid Date';
    }
    const day = dateObj.getDate().toString().padStart(2, '0');
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const year = dateObj.getFullYear();
    const hours = dateObj.getHours().toString().padStart(2, '0');
    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
    const seconds = dateObj.getSeconds().toString().padStart(2, '0');
    // Report format: DD/MM/YYYY HH:mm:ss or MM/DD/YYYY HH:mm:ss
    const datePart = format === 'AU'
        ? `${day}/${month}/${year}`
        : `${month}/${day}/${year}`;
    return `${datePart} ${hours}:${minutes}:${seconds}`;
}
/**
 * Get relative time string (e.g., "2 hours ago", "just now")
 */
export function getRelativeTime(date) {
    const dateObj = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffSec < 10)
        return 'just now';
    if (diffSec < 60)
        return `${diffSec} seconds ago`;
    if (diffMin < 60)
        return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
    if (diffHour < 24)
        return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
    if (diffDay < 7)
        return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
    if (diffDay < 30) {
        const weeks = Math.floor(diffDay / 7);
        return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
    }
    if (diffDay < 365) {
        const months = Math.floor(diffDay / 30);
        return `${months} month${months !== 1 ? 's' : ''} ago`;
    }
    const years = Math.floor(diffDay / 365);
    return `${years} year${years !== 1 ? 's' : ''} ago`;
}
/**
 * Parse a date string in either AU or US format
 * @param dateStr - Date string to parse
 * @param format - Expected format
 * @returns Date object or null if invalid
 */
export function parseDate(dateStr, format = 'AU') {
    const parts = dateStr.split(/[/\-\s:]+/);
    if (parts.length < 3) {
        return null;
    }
    const [first, second, third] = parts.map(p => parseInt(p, 10));
    // Check for NaN values from parseInt
    if (isNaN(first) || isNaN(second) || isNaN(third)) {
        return null;
    }
    let day = 0, month = 0, year = 0;
    if (format === 'AU') {
        // DD/MM/YYYY
        day = first;
        month = second;
        year = third;
    }
    else {
        // MM/DD/YYYY
        month = first;
        day = second;
        year = third;
    }
    // Basic range validation
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
        return null;
    }
    // Create date and validate it constructed correctly
    // JavaScript Date will normalize invalid dates (e.g., Feb 30 -> Mar 2)
    const date = new Date(year, month - 1, day);
    // Verify the date components match what we provided
    // This catches cases like February 30th which would normalize to March
    if (date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day) {
        return null;
    }
    // Add time if present
    if (parts.length >= 5) {
        const hours = parseInt(parts[3] || '0', 10);
        const minutes = parseInt(parts[4] || '0', 10);
        if (isNaN(hours) || isNaN(minutes)) {
            return null;
        }
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        date.setHours(hours, minutes);
        if (parts.length >= 6) {
            const seconds = parseInt(parts[5] || '0', 10);
            if (isNaN(seconds) || seconds < 0 || seconds > 59) {
                return null;
            }
            date.setSeconds(seconds);
        }
    }
    return date;
}
/**
 * Get user's preferred date format from localStorage or browser locale
 */
export function getUserDateFormat() {
    // Check localStorage first
    const stored = typeof window !== 'undefined'
        ? localStorage.getItem('dateFormat')
        : null;
    if (stored === 'AU' || stored === 'US') {
        return stored;
    }
    // Fallback to browser locale detection
    if (typeof window !== 'undefined' && navigator.language) {
        // Australian locales
        if (navigator.language.startsWith('en-AU') ||
            navigator.language.startsWith('en-NZ')) {
            return 'AU';
        }
        // US locales
        if (navigator.language.startsWith('en-US')) {
            return 'US';
        }
    }
    // Default to Australian format as specified in requirements
    return 'AU';
}
/**
 * Set user's preferred date format
 */
export function setUserDateFormat(format) {
    if (typeof window !== 'undefined') {
        localStorage.setItem('dateFormat', format);
    }
}
