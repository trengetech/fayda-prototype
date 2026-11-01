import type { ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View, type ImageSourcePropType } from 'react-native';
import { Button } from './components';
import { fontFamily } from './fonts';
import { Icon } from './icon';
import { IconButton, Segmented } from './parts';
import { useTheme } from './theme';
import { heights, radii } from './tokens';

/** A centred grey pill: "Private negotiation…", "Seller accepted · 3 min ago". */
export function SystemNote({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignSelf: 'center', maxWidth: '92%', backgroundColor: colors.surface2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill }}>
      <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 12, textAlign: 'center' }}>{children}</Text>
    </View>
  );
}

/** One chat or offer bubble. Mine is dark and on the right; theirs is white with an outline on the left (prototype `.bubble`). */
export function Bubble({ me, children, maxWidth = '82%' }: { me?: boolean; children: ReactNode; maxWidth?: `${number}%` }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignSelf: me ? 'flex-end' : 'flex-start', maxWidth, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1,
        backgroundColor: me ? colors.darkBtn : colors.surface, borderColor: me ? colors.darkBtn : colors.divider,
        ...(me ? { borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 }),
      }}
    >
      {children}
    </View>
  );
}

/** Text inside a Bubble, in the right colour for whose bubble it is. */
export function BubbleText({ me, size = 14, weight = 'regular', dim, children }: { me?: boolean; size?: number; weight?: keyof typeof fontFamily; dim?: boolean; children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={{ color: me ? colors.darkBtnFg : colors.ink, fontFamily: fontFamily[weight], fontSize: size, opacity: dim ? 0.7 : 1 }}>{children}</Text>;
}

/** The bar pinned to the bottom of a screen that holds the main actions (prototype `.actionbar`). */
export function ActionBar({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface }}>{children}</View>;
}

/** Two buttons side by side. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{Array.isArray(children) ? children.filter(Boolean).map((c, i) => <View key={i} style={{ flex: 1 }}>{c}</View>) : <View style={{ flex: 1 }}>{children}</View>}</View>;
}

/** A square picture with rounded corners, or a plain tile when there is none. */
export function Thumb({ source, size = 56, label }: { source?: ImageSourcePropType | null; size?: number; label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      {source ? <Image source={source} style={{ width: size, height: size }} resizeMode="cover" accessibilityLabel={label} accessibilityIgnoresInvertColors /> : <Icon name="image" size={Math.round(size * 0.4)} color={colors.faint} />}
    </View>
  );
}

/** A bottom sheet over a dimmed screen: grabber, title, close button, scrolling body, and a pinned footer (prototype `.sheet`). */
export function Sheet({ visible, title, onClose, footer, children }: { visible: boolean; title: string; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,11,14,0.45)', justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel={`Close ${title}`} onPress={onClose} style={{ flex: 1 }} />
        <View style={{ maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 99, backgroundColor: colors.border, marginTop: 8 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
            <Text accessibilityRole="header" style={{ flex: 1, color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 17 }}>{title}</Text>
            <IconButton plain icon="x" label="Close" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>{children}</ScrollView>
          {footer ? <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.divider }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export type AmountMode = 'inr' | 'pct';

/** Rupees an offer comes to, in whole rupees, or null while nothing is typed (prototype `amountFrom`). */
export function amountFromInput(mode: AmountMode, value: string, listPricePaise: number): number | null {
  if (value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return mode === 'pct' ? Math.round((listPricePaise / 100) * (1 - n / 100)) : n;
}

/** "My price (₹)" / "Discount (%)" switch and one number box (prototype `AmountInput`). */
export function AmountInput({ listPrice, value, onChange, mode, onMode, invalid, label = 'Amount' }: { listPrice: number; value: string; onChange: (v: string) => void; mode: AmountMode; onMode: (m: AmountMode) => void; invalid?: boolean; label?: string }) {
  const { colors } = useTheme();
  const rupees = amountFromInput(mode, value, listPrice);
  return (
    <View style={{ gap: 8 }}>
      <Segmented value={mode} onChange={onMode} options={[{ key: 'inr', label: 'My price (₹)' }, { key: 'pct', label: 'Discount (%)' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ height: heights.input, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface3, justifyContent: 'center' }}>
          <Text style={{ color: colors.ink, fontFamily: fontFamily.bold, fontSize: 16 }}>{mode === 'pct' ? '%' : '₹'}</Text>
        </View>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={(v) => onChange(v.replace(/[^0-9]/g, '').slice(0, 8))}
          keyboardType="number-pad"
          placeholder={mode === 'pct' ? 'e.g. 12' : `e.g. ${Math.round((listPrice / 100) * 0.88)}`}
          placeholderTextColor={colors.faint}
          style={{ flex: 1, height: heights.input, paddingHorizontal: 14, borderWidth: 1.5, borderColor: invalid ? colors.danger : colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.ink, fontFamily: fontFamily.regular, fontSize: 16 }}
        />
      </View>
      {mode === 'pct' && rupees != null && Number.isFinite(rupees) ? <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 12 }}>{`${value}% off = ₹${rupees.toLocaleString('en-IN')}`}</Text> : null}
    </View>
  );
}

/** The chat box pinned under a conversation: optional icon buttons on the left, one line of text, and Send (prototype `.composer`). */
export function Composer({ value, onChangeText, onSend, canSend, sending, left }: { value: string; onChangeText: (v: string) => void; onSend: () => void; canSend: boolean; sending?: boolean; left?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface }}>
      {left}
      <TextInput
        accessibilityLabel="Message"
        placeholder="Message…"
        placeholderTextColor={colors.faint}
        value={value}
        onChangeText={onChangeText}
        maxLength={1000}
        multiline
        style={{ flex: 1, minHeight: heights.inputCompact, maxHeight: 110, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.ink, fontFamily: fontFamily.regular, fontSize: 15 }}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }} disabled={!canSend} onPress={onSend} style={{ height: heights.btnSm, paddingHorizontal: 14, borderRadius: 11, backgroundColor: colors.accent, justifyContent: 'center', opacity: canSend ? 1 : 0.45 }}>
        <Text style={{ color: colors.onAccent, fontFamily: fontFamily.bold, fontSize: 13 }}>{sending ? 'Sending…' : 'Send'}</Text>
      </Pressable>
    </View>
  );
}

/** A centred question with Cancel and a confirm button (prototype `Confirm`). `danger` makes the confirm button red. */
export function Confirm({ visible, title, body, confirmLabel, cancelLabel = 'Cancel', danger, busy, onConfirm, onCancel }: { visible: boolean; title: string; body?: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,11,14,0.5)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
        <View accessibilityViewIsModal accessibilityLabel={title} style={{ width: '100%', backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: colors.ink, fontFamily: fontFamily.extrabold, fontSize: 18 }}>{title}</Text>
          {body ? <Text style={{ color: colors.muted, fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20 }}>{body}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button title={cancelLabel} variant="outline" onPress={onCancel} /></View>
            <View style={{ flex: 1 }}><Button title={confirmLabel} variant={danger ? 'danger' : 'primary'} loading={!!busy} onPress={onConfirm} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
