import { useState, useEffect, useRef } from 'react';
import { getStorageItem, setStorageItem } from '@/utils/storage';

/**
 * A useState hook that persists its value to localStorage.
 * Reads from localStorage on mount and writes on every change.
 *
 * @param key - localStorage key (should be unique per setting)
 * @param defaultValue - fallback if nothing is stored
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => getStorageItem<T>(key, defaultValue));
  const isInitialMount = useRef(true);

  // Persist to localStorage whenever the value changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setStorageItem(key, state);
  }, [key, state]);

  return [state, setState];
}
