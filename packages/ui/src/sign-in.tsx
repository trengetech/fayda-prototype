import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button } from './components';
import { Icon, type IconName } from './icon';
import { IconButton } from './parts';
import { useTheme } from './theme';
import { TextField, Screen, describeError } from './forms';

export interface SignInProps {
  appName: 'Buyer' | 'Seller';
  /** Asks the server to send a code. Resolves with whether the code is simulated. */
  onRequestCode: (phone: string) => Promise<{ simulated: boolean }>;
  onVerify: (phone: string, code: string) => Promise<void>;
}

/** Phone number, then code. Shared by both apps. A simulated code is always said to be simulated. */
export function SignInScreen({ appName, onRequestCode, onVerify }: SignInProps) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [simulated, setSimulated] = useState(true);
  const [busy, setBusy] = useState(false);
  const { colors } = useTheme();
  const seller = appName === 'Seller';
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const brandIcon: IconName = seller ? 'store' : 'tag';
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={brandIcon} size={22} color={colors.onAccent} />
        </View>
        <AppText weight="extrabold" size={22} style={{ letterSpacing: -0.5 }}>Fayda <AppText tone="muted" weight="bold" size={14}>{appName}</AppText></AppText>
      </View>
      {step === 'code' ? <IconButton icon="back" label="Back" onPress={() => { setError(null); setStep('phone'); }} /> : null}
      <View style={{ gap: 8, paddingTop: step === 'phone' ? 12 : 0 }}>
        <AppText weight="extrabold" size={step === 'phone' ? 30 : 26} style={{ letterSpacing: -0.5, lineHeight: step === 'phone' ? 34 : 30 }}>
          {step === 'phone' ? (seller ? 'Post once. Sell on your terms.' : 'Shop it. Bargain it.') : 'Enter the 6-digit code'}
        </AppText>
        <AppText tone="muted" size={15}>
          {step === 'phone'
            ? seller
              ? 'Publish videos and photos, set your price and private bargaining rules, and answer offers in one place.'
              : 'Watch product videos, then buy or make an offer directly to the seller.'
            : `Sent to +91 ${phone.replace(/(\d{5})(\d{5})/, '$1 $2')}`}
        </AppText>
        {step === 'phone' ? <AppText tone="muted" size={12}>Sign in to Fayda {appName}. The same mobile number works in both the Buyer and Seller apps.</AppText> : null}
      </View>

      {step === 'phone' ? (
        <>
          <TextField label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" prefix="+91" placeholder="98765 43210" maxLength={10} error={error?.fields.phone} />
          {error && !error.fields.phone ? <AppText tone="danger" size={13} accessibilityRole="alert">{error.message}</AppText> : null}
          <Button title="Send code" variant="dark" size="lg" loading={busy} disabled={phone.length < 10} onPress={() => void run(async () => { setSimulated((await onRequestCode(phone)).simulated); setCode(''); setStep('code'); })} />
        </>
      ) : (
        <>
          {simulated ? (
            <View style={{ backgroundColor: colors.accentTint, borderColor: colors.accentTint2, borderWidth: 1, borderRadius: 16, padding: 14, gap: 2 }}>
              <AppText weight="extrabold" size={13}>Simulated sign-in</AppText>
              <AppText size={13}>No SMS is sent while this app is a prototype. Use the code 123456.</AppText>
            </View>
          ) : null}
          <TextField otp label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} error={error?.fields.code} />
          {error && !error.fields.code ? <AppText tone="danger" size={13} accessibilityRole="alert">{error.message}</AppText> : null}
          <Button title="Verify and continue" size="lg" loading={busy} disabled={code.length < 6} onPress={() => void run(() => onVerify(phone, code))} />
          <Button title="Use a different number" variant="ghost" onPress={() => { setError(null); setStep('phone'); }} />
        </>
      )}
    </Screen>
  );
}
