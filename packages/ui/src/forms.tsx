import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { AppText } from './components';
import { fontFamily } from './fonts';
import { Chip } from './parts';
import { useTheme } from './theme';
import { heights, radii, spacing, type } from './tokens';

/** What a failed call looks like to a form: a message, and per-field messages when the server sent them. */
export function describeError(e: unknown): { message: string; fields: Record<string, string> } {
  const problem = (e as { problem?: { fields?: Record<string, string> } } | null)?.problem;
  return { message: e instanceof Error ? e.message : 'Something went wrong. Try again.', fields: problem?.fields ?? {} };
}

export function FieldError({ children }: { children?: string | undefined }) {
  if (!children) return null;
  return (
    <AppText tone="danger" size={12} accessibilityRole="alert">
      {children}
    </AppText>
  );
}

export interface TextFieldProps {
  /** Big, centred, letter-spaced digits for a one-time code. */
  otp?: boolean;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | undefined;
  hint?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  /** Shown before the text, e.g. +91 */
  prefix?: string;
  optional?: boolean;
  /** Lets a scrolling screen bring the field into view above the keyboard. */
  onFocus?: () => void;
}

export function TextField({ label, value, onChangeText, error, hint, placeholder, keyboardType, maxLength, multiline, autoCapitalize, prefix, optional, onFocus, otp }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <AppText weight="semibold" size={13}>
        {label}
        {optional ? <AppText tone="faint" size={13}> (optional)</AppText> : null}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: multiline ? 96 : otp ? heights.otp : heights.input, borderRadius: radii.md, borderWidth: 1.5, borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, gap: 8 }}>
        {prefix ? <AppText tone="muted">{prefix}</AppText> : null}
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          autoCorrect={false}
          style={{ flex: 1, color: colors.ink, fontFamily: otp ? fontFamily.extrabold : fontFamily.regular, fontSize: otp ? 24 : type.input.fontSize, ...(otp ? { letterSpacing: 12, textAlign: 'center' as const } : {}), paddingVertical: multiline ? 12 : 0, textAlignVertical: multiline ? 'top' : 'center' }}
        />
      </View>
      {hint && !error ? <AppText tone="muted" size={12}>{hint}</AppText> : null}
      <FieldError>{error}</FieldError>
    </View>
  );
}

/** Pick one or several of a short list (categories, delivery times). */
export function ChipGroup<T extends string | number>({ label, options, value, onChange, multiple, error, format }: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; multiple?: boolean; error?: string | undefined; format?: (o: T) => string }) {
  const toggle = (o: T) => onChange(multiple ? (value.includes(o) ? value.filter((x) => x !== o) : [...value, o]) : [o]);
  return (
    <View style={{ gap: 6 }}>
      {label && label !== 'Show' ? <AppText weight="semibold" size={13}>{label}</AppText> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => (
          <Chip key={String(o)} label={format ? format(o) : String(o)} selected={value.includes(o)} onPress={() => toggle(o)} />
        ))}
      </View>
      <FieldError>{error}</FieldError>
    </View>
  );
}

export function Checkbox({ checked, onChange, children, error }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string | undefined }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: checked ? colors.accent : error ? colors.danger : colors.border, backgroundColor: checked ? colors.accent : colors.surface, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
          {checked ? <Text style={{ color: colors.onAccent, fontFamily: fontFamily.extrabold, fontSize: 14 }}>✓</Text> : null}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </Pressable>
      <FieldError>{error}</FieldError>
    </View>
  );
}

/** A scrolling page for forms and content. Taps on buttons work while the keyboard is open. */
export function Screen({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? colors.accent : colors.divider }} />)}
      </View>
      <AppText tone="muted" weight="extrabold" size={12}>Step {step} of {total}</AppText>
      <AppText weight="extrabold" size={24} style={{ letterSpacing: -0.4 }}>{title}</AppText>
    </View>
  );
}
