import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { AppText, Button } from './components';
import { TextField } from './forms';
import { useTheme } from './theme';

export const REPORT_CHOICES = [
  { key: 'SPAM', label: 'Spam' },
  { key: 'ABUSE', label: 'Abuse or harassment' },
  { key: 'SCAM', label: 'Misleading or a scam' },
  { key: 'OTHER', label: 'Something else' },
] as const;
export type ReportChoice = (typeof REPORT_CHOICES)[number]['key'];

/** A sheet to pick why something is reported, with an optional note. `onSubmit` rejects with an Error to show a message. */
export function ReportSheet({ visible, title, onClose, onSubmit }: { visible: boolean; title: string; onClose: () => void; onSubmit: (reason: ReportChoice, note: string) => Promise<void> }) {
  const { colors } = useTheme();
  const [reason, setReason] = useState<ReportChoice | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setReason(null);
    setNote('');
    setError(null);
    onClose();
  };
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason, note);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          <AppText weight="extrabold" size={18}>{title}</AppText>
          <AppText tone="muted" size={13}>Why are you reporting this? We keep a copy and review it.</AppText>
          {REPORT_CHOICES.map((c) => (
            <Pressable
              key={c.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === c.key }}
              onPress={() => setReason(c.key)}
              style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: reason === c.key ? colors.accent : colors.border, backgroundColor: reason === c.key ? colors.accentTint : 'transparent' }}
            >
              <AppText weight={reason === c.key ? 'bold' : 'regular'}>{c.label}</AppText>
            </Pressable>
          ))}
          <TextField label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={300} />
          {error ? <AppText tone="danger" size={12} accessibilityRole="alert">{error}</AppText> : null}
          <Button title="Send report" disabled={!reason} loading={busy} onPress={() => void send()} />
          <Button title="Cancel" variant="ghost" onPress={close} />
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * "Report" and "Block" links for something another person wrote. The parent does the work (`onReport`, `onBlock`); this asks
 * first, shows the sheet, and says what happened. Never shown on your own words.
 */
export function SafetyActions({ what, who, onReport, onBlock }: { what: string; who: string; onReport: (reason: ReportChoice, note: string) => Promise<void>; onBlock: () => Promise<void> }) {
  const [sheet, setSheet] = useState(false);
  const [reported, setReported] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const confirmBlock = () =>
    Alert.alert(`Block ${who}?`, 'You will not see their comments, and you will not be able to message each other. Existing orders stay as they are. You can unblock later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => void onBlock().then(() => setBlocked(`${who} is blocked.`), (e: unknown) => setBlocked(e instanceof Error ? e.message : 'Could not block.')) },
    ]);
  return (
    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
      {reported ? (
        <AppText tone="muted" size={12} accessibilityRole="alert">Reported. Thank you.</AppText>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Report ${what}`} hitSlop={8} onPress={() => setSheet(true)}>
          <AppText tone="muted" size={12}>Report</AppText>
        </Pressable>
      )}
      {blocked ? (
        <AppText tone="muted" size={12} accessibilityRole="alert">{blocked}</AppText>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Block ${who}`} hitSlop={8} onPress={confirmBlock}>
          <AppText tone="muted" size={12}>Block</AppText>
        </Pressable>
      )}
      <ReportSheet
        visible={sheet}
        title={`Report ${what}`}
        onClose={() => setSheet(false)}
        onSubmit={async (r, n) => {
          await onReport(r, n);
          setReported(true);
        }}
      />
    </View>
  );
}
