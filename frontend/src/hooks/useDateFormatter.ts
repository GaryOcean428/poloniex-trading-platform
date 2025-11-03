/**
 * useDateFormatter Hook
 * Provides date formatting functions with locale support
 */

import { useCallback, useMemo } from 'react';
import { formatDate, formatTime, formatDateTime, formatRelativeTime, DateLocale } from '../utils/dateFormatter';

export function useDateFormatter() {
  // Get locale from localStorage or default to 'en-AU'
  const locale: DateLocale = useMemo(() => {
    const savedLocale = localStorage.getItem('dateLocale');
    return (savedLocale as DateLocale) || 'en-AU';
  }, []);

  const setLocale = useCallback((newLocale: DateLocale) => {
    localStorage.setItem('dateLocale', newLocale);
    // Force re-render by dispatching a custom event
    window.dispatchEvent(new CustomEvent('localeChanged'));
  }, []);

  const formatDateFn = useCallback((date: Date | string | number) => {
    return formatDate(date, locale);
  }, [locale]);

  const formatTimeFn = useCallback((date: Date | string | number) => {
    return formatTime(date, locale);
  }, [locale]);

  const formatDateTimeFn = useCallback((date: Date | string | number) => {
    return formatDateTime(date, locale);
  }, [locale]);

  const formatRelativeTimeFn = useCallback((date: Date | string | number) => {
    return formatRelativeTime(date, locale);
  }, [locale]);

  return {
    locale,
    setLocale,
    formatDate: formatDateFn,
    formatTime: formatTimeFn,
    formatDateTime: formatDateTimeFn,
    formatRelativeTime: formatRelativeTimeFn,
  };
}
