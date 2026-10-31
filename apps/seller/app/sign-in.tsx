import { useSessionManager } from '@fayda/api-client';
import { SignInScreen } from '@fayda/ui';

export default function SignIn() {
  const manager = useSessionManager();
  return (
    <SignInScreen
      appName="Seller"
      onRequestCode={(phone) => manager.client.requestOtp(phone, 'seller')}
      onVerify={(phone, code) => manager.signIn(phone, code)}
    />
  );
}
