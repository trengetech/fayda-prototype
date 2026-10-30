/**
 * Design tokens ported from prototype/src/styles.css. Names match the CSS variables (ink, muted, accent-strong → accentStrong).
 * Light is the default; dark mirrors the prototype's dark theme. Contrast of text pairs is tested.
 */
export interface Palette {
  ink: string; muted: string; faint: string;
  accent: string; accentStrong: string; accentTint: string; accentTint2: string; onAccent: string;
  border: string; divider: string; surface: string; surface2: string; surface3: string;
  success: string; successTint: string; danger: string; dangerTint: string; info: string; infoTint: string;
  darkBtn: string; darkBtnFg: string;
}

export const light: Palette = {
  ink: '#111318', muted: '#5B6170', faint: '#8A8F9A',
  accent: '#C2410C', accentStrong: '#9A3412', accentTint: '#FFF7ED', accentTint2: '#FFEDD5', onAccent: '#FFFFFF',
  border: '#D5D8DE', divider: '#E3E5E9', surface: '#FFFFFF', surface2: '#F1F2F4', surface3: '#F7F7F8',
  success: '#047857', successTint: '#DCFCE7', danger: '#B91C1C', dangerTint: '#FEE2E2', info: '#1E40AF', infoTint: '#DBEAFE',
  darkBtn: '#111318', darkBtnFg: '#FFFFFF',
};

export const dark: Palette = {
  ink: '#F2F3F5', muted: '#A6ABB5', faint: '#7D828C',
  accent: '#EA580C', accentStrong: '#FDBA74', accentTint: '#2A1A10', accentTint2: '#3A2414', onAccent: '#FFFFFF',
  border: '#3A3D45', divider: '#2A2C32', surface: '#16171B', surface2: '#22242A', surface3: '#1C1D22',
  success: '#34D399', successTint: '#0E2D22', danger: '#F87171', dangerTint: '#3A1717', info: '#93C5FD', infoTint: '#172554',
  darkBtn: '#F2F3F5', darkBtnFg: '#111318',
};

export const palettes = { light, dark } as const;
export type Scheme = keyof typeof palettes;

export const radii = { sm: 10, md: 12, lg: 14, xl: 20, pill: 99 } as const;

/** Control heights in dp. btn* are buttons, input is text fields, iconButton is square. */
export const heights = {
  btn: 48, btnLg: 54, btnSm: 38, input: 50, inputCompact: 44, otp: 58,
  iconButton: 40, chip: 36, segmented: 40, badge: 22, appBar: 58,
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Type scale from the prototype (px → dp). */
export const type = {
  h2: { fontSize: 20, letterSpacing: -0.4 },
  h3: { fontSize: 15 },
  body: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12 },
  tiny: { fontSize: 11 },
  price: { fontSize: 17, letterSpacing: -0.2 },
  input: { fontSize: 16 },
  button: { fontSize: 15 },
} as const;
