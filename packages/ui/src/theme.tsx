import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { palettes, type Palette, type Scheme } from './tokens';

interface Theme {
  scheme: Scheme;
  colors: Palette;
}
const ThemeContext = createContext<Theme | null>(null);

/** Follows the phone's light/dark setting unless `scheme` is forced (the gallery does this). */
export function ThemeProvider({ scheme, children }: { scheme?: Scheme; children: ReactNode }) {
  const system = useColorScheme();
  const resolved: Scheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  return <ThemeContext.Provider value={{ scheme: resolved, colors: palettes[resolved] }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside ThemeProvider');
  return t;
}
