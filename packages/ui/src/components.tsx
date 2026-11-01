import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps, type ViewStyle } from 'react-native';
import { fontFamily } from './fonts';
import { Icon, type IconName } from './icon';
import { useTheme } from './theme';
import { heights, radii, spacing, type } from './tokens';

type Weight = keyof typeof fontFamily;

/** Text in the app font. `tone` picks a palette colour; `weight` picks the bundled font file. */
export function AppText({ weight = 'regular', tone = 'ink', size, style, ...rest }: TextProps & { weight?: Weight; tone?: 'ink' | 'muted' | 'faint' | 'accent' | 'danger' | 'success'; size?: number }) {
  const { colors } = useTheme();
  return <Text {...rest} style={[{ fontFamily: fontFamily[weight], color: colors[tone], fontSize: size ?? type.body.fontSize, lineHeight: size ? Math.round(size * 1.45) : type.body.lineHeight }, style]} />;
}

export function Button({ title, onPress, variant = 'primary', size = 'md', disabled, loading, accessibilityLabel, icon, block = true }: { icon?: IconName; block?: boolean; title: string; accessibilityLabel?: string; onPress?: () => void; variant?: 'primary' | 'dark' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; disabled?: boolean; loading?: boolean }) {
  const { colors } = useTheme();
  const bg = { primary: colors.accent, dark: colors.darkBtn, outline: colors.surface, ghost: 'transparent', danger: colors.surface }[variant];
  const fg = { primary: colors.onAccent, dark: colors.darkBtnFg, outline: colors.ink, ghost: colors.accent, danger: colors.danger }[variant];
  const border = variant === 'outline' ? colors.border : variant === 'danger' ? colors.danger : 'transparent';
  const h = size === 'lg' ? heights.btnLg : size === 'sm' ? heights.btnSm : heights.btn;
  const style: ViewStyle = { height: h, borderRadius: size === 'sm' ? 11 : radii.lg, backgroundColor: bg, borderColor: border, borderWidth: 1.5, paddingHorizontal: size === 'sm' ? 12 : 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.45 : 1, ...(block ? {} : { alignSelf: 'flex-start' }) };
  return (
    <Pressable accessibilityRole="button" {...(accessibilityLabel ? { accessibilityLabel } : {})} accessibilityState={{ disabled: !!disabled }} disabled={disabled || loading} onPress={onPress} style={style}>
      {loading ? <ActivityIndicator color={fg} /> : <>{icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} color={fg} /> : null}<Text style={{ color: fg, fontFamily: fontFamily.bold, fontSize: size === 'sm' ? 13 : size === 'lg' ? 16 : type.button.fontSize }}>{title}</Text></>}
    </Pressable>
  );
}

/** Persistent notice that the app is a prototype. Never hide it while sign-in or media are simulated. */
export function PrototypeBanner({ children }: { children?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.accentTint, borderBottomColor: colors.accentTint2, borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
      <Text style={{ color: colors.accentStrong, fontFamily: fontFamily.bold, fontSize: type.tiny.fontSize }}>PROTOTYPE · simulated sign-in, not for real orders</Text>
      {children}
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ backgroundColor: colors.surface, borderColor: colors.divider, borderWidth: 1.5, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md }}>{children}</View>;
}

export function Badge({ label, tone }: { label: string; tone: 'success' | 'danger' | 'info' | 'accent' }) {
  const { colors } = useTheme();
  const map = { success: [colors.successTint, colors.success], danger: [colors.dangerTint, colors.danger], info: [colors.infoTint, colors.info], accent: [colors.accentTint2, colors.accentStrong] } as const;
  const [bg, fg] = map[tone];
  return <View style={{ alignSelf: 'flex-start', height: heights.badge, borderRadius: radii.pill, paddingHorizontal: 8, backgroundColor: bg, justifyContent: 'center' }}><Text style={{ color: fg, fontFamily: fontFamily.bold, fontSize: type.tiny.fontSize }}>{label}</Text></View>;
}

export const styles = StyleSheet.create({ screen: { flex: 1 }, pad: { padding: spacing.lg }, stack: { gap: spacing.md } });
