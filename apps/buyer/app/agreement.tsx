import { AppText, Badge, Card, Screen } from '@fayda/ui';
import { View } from 'react-native';
import { AGREEMENT_NOTE, AGREEMENT_POINTS } from '../src/agreement';

/** The user agreement you accepted. It is a draft and says so. */
export default function AgreementScreen() {
  return (
    <Screen>
      <Badge label="Draft, pending legal review" tone="accent" />
      <Card>
        {AGREEMENT_POINTS.map((p, i) => (
          <View key={p} style={{ flexDirection: 'row', gap: 8 }}>
            <AppText tone="muted" weight="bold" size={13}>{i + 1}.</AppText>
            <AppText size={13} style={{ flex: 1 }}>{p}</AppText>
          </View>
        ))}
      </Card>
      <AppText tone="muted" size={12}>{AGREEMENT_NOTE}</AppText>
    </Screen>
  );
}
