import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card } from './components';
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

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <AppText weight="extrabold" size={24}>{step === 'phone' ? `Sign in to Fayda ${appName}` : 'Enter the code'}</AppText>
        <AppText tone="muted">
          {step === 'phone' ? 'Use your mobile number. The same number works in the Buyer and Seller apps.' : `For +91 ${phone}`}
        </AppText>
      </View>

      {step === 'phone' ? (
        <>
          <TextField label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" prefix="+91" placeholder="98765 43210" maxLength={10} error={error?.fields.phone} />
          {error && !error.fields.phone ? <AppText tone="danger" size={13} accessibilityRole="alert">{error.message}</AppText> : null}
          <Button title="Send code" size="lg" loading={busy} disabled={phone.length < 10} onPress={() => void run(async () => { setSimulated((await onRequestCode(phone)).simulated); setCode(''); setStep('code'); })} />
        </>
      ) : (
        <>
          {simulated ? (
            <Card>
              <AppText weight="bold">Simulated sign-in</AppText>
              <AppText tone="muted" size={13}>No SMS is sent while this app is a prototype. Use the code 123456.</AppText>
            </Card>
          ) : null}
          <TextField label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} error={error?.fields.code} />
          {error && !error.fields.code ? <AppText tone="danger" size={13} accessibilityRole="alert">{error.message}</AppText> : null}
          <Button title="Verify and continue" size="lg" loading={busy} disabled={code.length < 6} onPress={() => void run(() => onVerify(phone, code))} />
          <Button title="Use a different number" variant="ghost" onPress={() => { setError(null); setStep('phone'); }} />
        </>
      )}
    </Screen>
  );
}
