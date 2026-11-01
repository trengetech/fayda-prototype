import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { fontFamily } from './fonts';
import { Icon, type IconName } from './icon';
import { useTheme } from './theme';
import { heights, radii, spacing, type } from './tokens';

/** Small count bubble in the accent colour (the prototype's `.dot`). Renders nothing for 0. */
export function CountDot({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  if (!count) return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={[{ minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: colors.onAccent, fontFamily: fontFamily.bold, fontSize: 10 }}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

/** Square 40dp icon button with an outline, an optional count dot, and a spoken label (prototype `.iconbtn`). */
export function IconButton({ icon, label, onPress, count = 0, plain, glass, color, size = 22 }: { icon: IconName; label: string; onPress?: () => void; count?: number; plain?: boolean; glass?: boolean; color?: string; size?: number }) {
  const { colors } = useTheme();
  const round = glass;
  const bg = glass ? 'rgba(255,255,255,0.16)' : colors.surface;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} new` : label} onPress={onPress} hitSlop={4}
      style={{ width: heights.iconButton, height: heights.iconButton, borderRadius: round ? radii.pill : radii.md, borderWidth: plain || glass ? 0 : 1.5, borderColor: colors.divider, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={size} color={color ?? (glass ? '#FFFFFF' : colors.ink)} />
      <CountDot count={count} style={{ position: 'absolute', top: 2, right: 2 }} />
    </Pressable>
  );
}

/** Top bar: optional back button, a bold title, and actions on the right (prototype `.appbar`). */
export function AppBar({ title, onBack, right, subtitle }: { title: string; onBack?: () => void; right?: ReactNode; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ minHeight: heights.appBar, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface }}>
      {onBack ? <IconButton icon="back" label="Back" onPress={onBack} /> : null}
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 17, letterSpacing: -0.2 }}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: type.small.fontSize }}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{right}</View> : null}
    </View>
  );
}

export interface TabItem { key: string; label: string; icon: IconName; count?: number }

/** Bottom tab bar (prototype `.tabbar`): icon over label, the current tab in the accent colour, count dots. */
export function TabBar({ tabs, current, onSelect }: { tabs: readonly TabItem[]; current: string; onSelect: (key: string) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface, paddingBottom: 2 }}>
      {tabs.map((t) => {
        const on = t.key === current;
        const color = on ? colors.accent : colors.muted;
        return (
          <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.count ? `${t.label}, ${t.count} new` : t.label} onPress={() => onSelect(t.key)} style={{ flex: 1, alignItems: 'center', gap: 3, paddingTop: 8, paddingBottom: 7 }}>
            <View>
              <Icon name={t.icon} size={24} color={color} />
              <CountDot count={t.count ?? 0} style={{ position: 'absolute', top: -4, right: -10 }} />
            </View>
            <Text style={{ color, fontFamily: fontFamily.bold, fontSize: 11 }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Filter chip (prototype `.chip`); pressed = dark fill, or accent tint when `accent`. */
export function Chip({ label, selected, onPress, accent, disabled }: { label: string; selected?: boolean; onPress?: () => void; accent?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  const bg = selected ? (accent ? colors.accentTint : colors.darkBtn) : colors.surface;
  const fg = selected ? (accent ? colors.accentStrong : colors.darkBtnFg) : colors.ink;
  const bd = selected ? (accent ? colors.accent : colors.darkBtn) : colors.border;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ height: heights.chip, paddingHorizontal: 13, borderRadius: radii.pill, borderWidth: 1.5, borderColor: bd, backgroundColor: bg, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: fg, fontFamily: fontFamily.bold, fontSize: 13, textDecorationLine: disabled ? 'line-through' : 'none' }}>{label}</Text>
    </Pressable>
  );
}

/** Horizontal strip of chips that scrolls sideways. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>{children}</ScrollView>;
}

/** Segmented control (prototype `.seg`). `glass` is the see-through version used over reels. */
export function Segmented<K extends string>({ options, value, onChange, glass }: { options: readonly { key: K; label: string }[]; value: K; onChange: (key: K) => void; glass?: boolean }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: radii.lg, backgroundColor: glass ? 'rgba(255,255,255,0.16)' : colors.surface2 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityLabel={o.label} accessibilityState={{ selected: on }} onPress={() => onChange(o.key)}
            style={{ flex: 1, height: glass ? 34 : heights.segmented, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (glass ? '#FFFFFF' : colors.surface) : 'transparent' }}>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: glass ? 13 : 14, color: on ? (glass ? '#111318' : colors.ink) : glass ? 'rgba(255,255,255,0.82)' : colors.muted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Round initial avatar (prototype `.avatar`). */
export function Avatar({ name, size = 36, light }: { name: string; size?: number; light?: boolean }) {
  const { colors } = useTheme();
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: light ? '#FFFFFF' : colors.darkBtn, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: light ? '#111318' : colors.darkBtnFg, fontFamily: fontFamily.extrabold, fontSize: Math.round(size * 0.4) }}>{initial}</Text>
    </View>
  );
}

/** One tappable row of a list: optional icon or thumbnail, title, a second line, a right-hand value or arrow. */
export function ListRow({ title, subtitle, icon, left, right, count, onPress, tone, last }: { title: string; subtitle?: string; icon?: IconName; left?: ReactNode; right?: ReactNode; count?: number; onPress?: () => void; tone?: 'danger'; last?: boolean }) {
  const { colors } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.divider, backgroundColor: colors.surface }}>
      {left ?? (icon ? <Icon name={icon} size={22} color={tone === 'danger' ? colors.danger : colors.ink} /> : null)}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: tone === 'danger' ? colors.danger : colors.ink, fontFamily: fontFamily.bold, fontSize: 15 }}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: type.small.fontSize }}>{subtitle}</Text> : null}
      </View>
      <CountDot count={count ?? 0} style={{ position: 'relative' }} />
      {right ?? (onPress ? <View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="back" size={18} color={colors.faint} /></View> : null)}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={count ? `${title}, ${count} new` : title} onPress={onPress}>{body}</Pressable> : body;
}

/** A number over a small caption, in a bordered tile (prototype `.stat`). */
export function StatTile({ value, label }: { value: string | number; label: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, minWidth: '30%', borderWidth: 1, borderColor: colors.divider, borderRadius: radii.lg, paddingVertical: 10, paddingHorizontal: 12, gap: 2 }}>
      <Text style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 18, letterSpacing: -0.3 }}>{value}</Text>
      <Text style={{ color: colors.muted, fontFamily: fontFamily.bold, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

/** Centered "nothing here yet" block with an icon (prototype `.empty`). */
export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: 40, gap: 8 }}>
      <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Icon name={icon} size={26} color={colors.muted} />
      </View>
      <Text style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 16, textAlign: 'center' }}>{title}</Text>
      {body ? <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 13, textAlign: 'center' }}>{body}</Text> : null}
      {action}
    </View>
  );
}

/** A gold star, the rating and how many reviews it comes from: "★ 4.0 (1)". Shows nothing before the first review. */
export function RatingChip({ rating, count, light }: { rating: number | null | undefined; count: number; light?: boolean }) {
  const { colors } = useTheme();
  if (rating == null) return null;
  return (
    <View accessibilityLabel={`Rated ${rating.toFixed(1)} from ${count} ${count === 1 ? 'review' : 'reviews'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon name="star" size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={1.5} />
      <Text style={{ color: light ? '#FFFFFF' : colors.ink, fontFamily: fontFamily.extrabold, fontSize: 12 }}>{rating.toFixed(1)}</Text>
      <Text style={{ color: light ? 'rgba(255,255,255,0.8)' : colors.muted, fontFamily: fontFamily.regular, fontSize: 12 }}>({count})</Text>
    </View>
  );
}

/** A small label, in the same shape as the prototype's `.badge`, for use where the tones in `Badge` do not fit. */
export function Tag({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'plain' }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', height: heights.badge, borderRadius: radii.pill, paddingHorizontal: 8, backgroundColor: tone === 'accent' ? colors.accentTint2 : colors.surface2, justifyContent: 'center' }}>
      <Text style={{ color: tone === 'accent' ? colors.accentStrong : colors.muted, fontFamily: fontFamily.extrabold, fontSize: type.tiny.fontSize }}>{label}</Text>
    </View>
  );
}

/**
 * A list row with a picture: thumbnail, title, a few small lines, and a badge on the right, with a divider under it
 * (prototype `.listrow` with `Thumb`). `children` sit under the row, in line with the text (for buttons like "Buy again").
 */
export function ThumbRow({ source, title, lines, badge, onPress, accessibilityLabel, children }: { source?: ImageSourcePropType | null; title: string; lines?: ReactNode; badge?: ReactNode; onPress?: () => void; accessibilityLabel?: string; children?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface }}>
      <Pressable accessibilityRole="button" {...(accessibilityLabel ? { accessibilityLabel } : {})} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
        <View style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface2 }}>
          {source ? <Image source={source} style={{ width: 56, height: 56 }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 14 }}>{title}</Text>
          {lines}
        </View>
        {badge}
      </Pressable>
      {children ? <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 84, paddingRight: 16, paddingBottom: 10, flexWrap: 'wrap' }}>{children}</View> : null}
    </View>
  );
}

/** A small muted line under a row's title. */
export function RowLine({ children, strong }: { children: ReactNode; strong?: boolean }) {
  const { colors } = useTheme();
  return <Text numberOfLines={1} style={{ color: strong ? colors.ink : colors.muted, fontFamily: strong ? fontFamily.extrabold : fontFamily.regular, fontSize: strong ? 14 : 12 }}>{children}</Text>;
}

/** A section heading: small, bold, with room above (prototype `.section-title`). */
export function SectionTitle({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text accessibilityRole="header" style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 13, marginTop: 10 }}>{children}</Text>;
}

/** One big selectable card with a title and a small description (prototype `.choice`): a payment method, an address. */
export function ChoiceCard({ title, description, selected, onPress, disabled, children }: { title: string; description?: string; selected: boolean; onPress: () => void; disabled?: boolean; children?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ selected, checked: selected, disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 2, borderColor: selected ? colors.accent : colors.divider, backgroundColor: selected ? colors.accentTint : colors.surface, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 14 }}>{title}</Text>
        {description ? <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 12 }}>{description}</Text> : null}
        {children}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.accent : colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.accent : 'transparent' }}>
        {selected ? <Icon name="check" size={13} color={colors.onAccent} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

/** A label on the left and a value on the right (prototype `.kv`). */
export function KeyValue({ label, value, strong, tone }: { label: string; value: ReactNode; strong?: boolean; tone?: 'success' | 'danger' }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 }}>
      <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 14 }}>{label}</Text>
      <Text style={{ flexShrink: 1, textAlign: 'right', color: tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.ink, fontFamily: strong ? fontFamily.extrabold : fontFamily.bold, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

export interface StepItem { key: string; title: string; note: string; done: boolean; failed?: boolean }

/** The order's steps down the page with a line between them; done steps are green with a tick (prototype `.status-steps`). */
export function Steps({ steps }: { steps: readonly StepItem[] }) {
  const { colors } = useTheme();
  return (
    <View>
      {steps.map((st, i) => {
        const fill = st.failed ? colors.danger : st.done ? colors.success : colors.surface;
        const edge = st.failed ? colors.danger : st.done ? colors.success : colors.border;
        return (
          <View key={st.key} accessible accessibilityLabel={`${st.title}${st.done ? ', done' : ''}`} style={{ flexDirection: 'row', gap: 12, paddingBottom: i === steps.length - 1 ? 0 : 14 }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: edge, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
                {st.done || st.failed ? <Icon name={st.failed ? 'x' : 'check'} size={12} color="#fff" strokeWidth={3} /> : null}
              </View>
              {i < steps.length - 1 ? <View style={{ position: 'absolute', top: 20, bottom: -14, width: 2, backgroundColor: colors.divider }} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 14 }}>{st.title}</Text>
              <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 11 }}>{st.note}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A row for a person or a shop: initial avatar, name, a line under it, an optional preview, and something on the right
 * (a badge, a time). Full width with a divider, like the prototype's chat and follow lists.
 */
export function PersonRow({ name, subtitle, preview, right, onPress, accessibilityLabel, unread, tinted }: { name: string; subtitle?: string; preview?: string | null; right?: ReactNode; onPress?: () => void; accessibilityLabel?: string; unread?: boolean; tinted?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" {...(accessibilityLabel ? { accessibilityLabel } : {})} onPress={onPress} disabled={!onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: tinted ? colors.accentTint : colors.surface }}>
      <Avatar name={name} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 14 }}>{name}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 11 }}>{subtitle}</Text> : null}
        {preview ? <Text numberOfLines={1} style={{ color: colors.ink, fontFamily: unread ? fontFamily.bold : fontFamily.regular, fontSize: 13 }}>{preview}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}
