import { useSession, useSessionManager } from '@fayda/api-client';
import { AppText, Button, Card } from '@fayda/ui';

/** Who is signed in, and a way to sign out. */
export function AccountCard() {
  const { user } = useSession();
  const manager = useSessionManager();
  if (!user) return null;
  return (
    <Card>
      <AppText weight="bold">{user.name ?? 'Signed in'}</AppText>
      <AppText tone="muted">+91 {user.phone}</AppText>
      <Button title="Sign out" variant="outline" onPress={() => void manager.signOut()} />
    </Card>
  );
}
