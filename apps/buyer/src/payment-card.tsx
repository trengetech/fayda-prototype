import { useApiClient } from '@fayda/api-client';
import type { BuyerOrder } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { openExternal, shareText } from './orders';

/** A value the buyer may need to copy: shown selectable, with a button that opens the share sheet (it has Copy). */
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <AppText tone="muted" size={12}>{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <AppText weight="bold" selectable style={{ flex: 1 }}>{value}</AppText>
        <Button title="Copy" size="sm" variant="outline" onPress={() => void shareText(value)} />
      </View>
    </View>
  );
}

/**
 * How to pay the seller. The API sends this only for the buyer's own direct order while it is PLACED (O-3), so this card
 * is simply absent otherwise. Fayda never touches the money: the buyer pays the seller directly.
 */
export function PaymentCard({ orderId, payment }: { orderId: string; payment: NonNullable<BuyerOrder['payment']> }) {
  const client = useApiClient();
  const { colors } = useTheme();
  const [notice, setNotice] = useState<string | null>(null);

  const payInApp = async () => {
    setNotice(null);
    if (!payment.upiUri || !(await openExternal(payment.upiUri))) setNotice(`No UPI app could open. Pay to the UPI ID ${payment.upiId ?? ''} from any UPI app, and write ${payment.note} as the note.`);
  };
  const openLink = async () => {
    setNotice(null);
    if (payment.paymentLink && !(await openExternal(payment.paymentLink))) setNotice('The link could not be opened. Copy it and open it in your browser.');
  };

  return (
    <Card>
      <AppText weight="bold">Pay {payment.payeeName} directly</AppText>
      <AppText tone="muted" size={13}>Pay {formatRupees(payment.amount)} to the seller. Fayda does not take your payment. Write the order number as the payment note so the seller can match it.</AppText>
      <CopyRow label="Payment note (order number)" value={payment.note} />
      {payment.method === 'UPI' ? (
        <>
          {payment.upiId ? <CopyRow label="UPI ID" value={payment.upiId} /> : null}
          {payment.upiUri ? <Button title="Pay in a UPI app" onPress={() => void payInApp()} /> : null}
          {payment.upiQrUrl ? (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Image source={client.getPaymentQrSource(orderId)} style={{ width: 200, height: 200, backgroundColor: colors.border }} accessibilityLabel="The seller’s UPI QR code" accessibilityIgnoresInvertColors />
              <AppText tone="muted" size={12}>Scan this from another phone, or from your UPI app’s “scan” screen.</AppText>
            </View>
          ) : null}
        </>
      ) : null}
      {payment.method === 'BANK' && payment.bank ? (
        <>
          <CopyRow label="Account holder" value={payment.bank.holder} />
          <CopyRow label="Account number" value={payment.bank.account} />
          <CopyRow label="IFSC" value={payment.bank.ifsc} />
          {payment.bank.bankName ? <AppText tone="muted" size={12}>{payment.bank.bankName}</AppText> : null}
        </>
      ) : null}
      {payment.method === 'LINK' && payment.paymentLink ? <Button title="Open the seller’s payment link" onPress={() => void openLink()} /> : null}
      {notice ? <AppText tone="danger" size={13} accessibilityRole="alert" selectable>{notice}</AppText> : null}
      <AppText tone="muted" size={12}>After you pay, the seller confirms the payment here. Only the seller can move the order forward.</AppText>
    </Card>
  );
}
