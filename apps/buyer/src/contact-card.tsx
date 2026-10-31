import type { BuyerOrder } from '@fayda/contracts/schemas';
import { AppText, Badge, Button, Card } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { CopyButton } from './copy';
import { daysText, hoursText, medianText, openExternal, telUrl, waUrl } from './orders';
import { ratingLine } from './stars';

/** Talk to the seller: chat always; phone and WhatsApp only while the order is open (the API sends `contact` only then, D12). */
export function ContactCard({ order }: { order: BuyerOrder }) {
  const router = useRouter();
  const s = order.seller;
  const [failed, setFailed] = useState<{ message: string; number: string } | null>(null);
  const typical = medianText(s.record.medianConfirmMs);

  const open = async (url: string, number: string) => {
    setFailed(null);
    if (!(await openExternal(url))) setFailed({ message: `Couldn’t open an app for this. The number is ${number}.`, number });
  };

  return (
    <Card>
      <AppText weight="bold">{s.name}</AppText>
      <AppText tone="muted" size={13}>{s.area} · {ratingLine(s.record.rating, s.record.reviewCount)}</AppText>
      <AppText tone="muted" size={13}>Confirms payment within {hoursText(s.slaConfirmHours)} · ships within {daysText(s.slaShipDays)}{typical ? ` · usually confirms in ${typical}` : ''}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Chat in app" variant="outline" disabled={!order.threadId} onPress={() => order.threadId && router.push(`/chat/${order.threadId}` as never)} />
        </View>
        {order.unread > 0 ? <Badge label={`${order.unread} new`} tone="accent" /> : null}
      </View>
      {s.contact?.whatsapp ? <Button title="WhatsApp" variant="outline" onPress={() => void open(waUrl(s.contact?.whatsapp as string, order.number), s.contact?.whatsapp as string)} /> : null}
      {s.contact?.phone ? <Button title="Call" variant="outline" onPress={() => void open(telUrl(s.contact?.phone as string), s.contact?.phone as string)} /> : null}
      {s.contact ? null : <AppText tone="muted" size={12}>Phone and WhatsApp are shown only while an order is open. You can still chat here.</AppText>}
      {failed ? (
        <>
          <AppText tone="danger" size={13} accessibilityRole="alert" selectable>{failed.message}</AppText>
          <CopyButton value={failed.number} title="Copy number" />
        </>
      ) : null}
    </Card>
  );
}
