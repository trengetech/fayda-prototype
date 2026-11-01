import { AppText, Card, Screen } from '@fayda/ui';
import { AGREEMENT_NOTE, AGREEMENT_POINTS } from '../src/agreement';

/** The user agreement you accepted. It is a draft and says so. */
export default function AgreementScreen() {
  return (
    <Screen>
      <Card>
        {AGREEMENT_POINTS.map((p) => (
          <AppText key={p}>• {p}</AppText>
        ))}
      </Card>
      <AppText tone="muted" size={12}>{AGREEMENT_NOTE}</AppText>
    </Screen>
  );
}
