import { useSessionManager } from '@fayda/api-client';
import { SignInScreen } from '@fayda/ui';

export default function SignIn() {
  const manager = useSessionManager();
  return (
    <SignInScreen
      appName="Buyer"
      onRequestCode={(phone) => manager.client.requestOtp(phone, 'buyer')}
      onVerify={(phone, code) => manager.signIn(phone, code)}
    />
  );
}
