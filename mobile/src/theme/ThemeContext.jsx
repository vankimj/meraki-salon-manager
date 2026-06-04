import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { getPrefs, subscribePrefs, setTheme as persistTheme } from '../lib/userPrefs';
import { themeFor } from './theme';

// Resolves the effective theme from the user's preference ('system' follows
// the OS; 'light'/'dark' force it) and exposes it app-wide. Re-renders when
// either the OS scheme or the saved preference changes.
const ThemeContext = createContext({ theme: themeFor('light'), mode: 'system', scheme: 'light', setMode: () => {} });

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme() || 'light';
  const [mode, setModeState] = useState(getPrefs().theme || 'system');

  useEffect(() => subscribePrefs(p => setModeState(p.theme || 'system')), []);

  const scheme = mode === 'system' ? systemScheme : mode;
  const theme  = useMemo(() => themeFor(scheme), [scheme]);

  const value = useMemo(() => ({
    theme,
    mode,                       // 'system' | 'light' | 'dark' (the preference)
    scheme,                     // 'light' | 'dark' (the resolved value)
    setMode: (m) => persistTheme(m),   // persists + notifies → re-renders
  }), [theme, mode, scheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Build StyleSheet styles from a (theme) => styles factory, memoized per theme.
// Usage:
//   const styles = useThemedStyles(makeStyles);
//   const makeStyles = (t) => StyleSheet.create({ wrap: { backgroundColor: t.bg } });
export function useThemedStyles(factory) {
  const { theme } = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
