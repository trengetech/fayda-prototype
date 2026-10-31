import { useMakeOffer } from '@fayda/api-client';
import type { BuyerListing } from '@fayda/contracts/schemas';
import { formatRupees, parseRupees, priceAfterPercentOff } from '@fayda/domain';
import { AppText, Button, Card, ChipGroup, TextField, describeError } from '@fayda/ui';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { newAttemptKey } from './offers';

const PERCENTS = [10, 15, 20, 30] as const;

/**
 * Make an offer on one size. The amount is typed in rupees, or picked as a percent off the listed price. The seller's
 * lowest price is never sent to this screen, so nothing here can hint at it.
 */
export function OfferSheet({ listing, onSent }: { listing: BuyerListing; onSent: (negotiationId: string) => void }) {
  const available = listing.variants.filter((v) => v.available);
  const [variantId, setVariantId] = useState<string | null>(available.length === 1 ? (available[0]?.id ?? null) : null);
  const [by, setBy] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [amountText, setAmountText] = useState('');
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const key = useRef(newAttemptKey());
  const make = useMakeOffer();

  const paise = by === 'AMOUNT' ? (parseRupees(amountText) ?? 0) * 100 : percent == null ? 0 : priceAfterPercentOff(listing.price, percent);
  const ready = !!variantId && paise > 0;

  const send = () => {
    if (!variantId || paise <= 0) return;
    setError(null);
    make.mutate(
      { listingId: listing.id, variantId, amount: paise, idempotencyKey: key.current },
      {
        onSuccess: (n) => {
          key.current = newAttemptKey();
          onSent(n.id);
        },
        // The same key is kept on failure, so a retry of the same offer cannot create two.
        onError: (e) => setError(describeError(e)),
      },
    );
  };
  // A different offer is a different attempt.
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    key.current = newAttemptKey();
    set(v);
  };

  return (
    <Card>
      <AppText weight="bold">Make an offer</AppText>
      <ChipGroup label="Size" options={available.map((v) => v.id)} value={variantId ? [variantId] : []} onChange={(v) => changed(setVariantId)(v[0] ?? null)} format={(id) => listing.variants.find((v) => v.id === id)?.label ?? ''} />
      <ChipGroup label="Offer by" options={['AMOUNT', 'PERCENT'] as const} value={[by]} onChange={(v) => v[0] && changed(setBy)(v[0])} format={(b) => (b === 'AMOUNT' ? 'Amount (₹)' : 'Discount (%)')} />
      {by === 'AMOUNT' ? (
        <TextField label="Your offer" prefix="₹" keyboardType="number-pad" value={amountText} onChangeText={changed(setAmountText)} hint={`Listed at ${formatRupees(listing.price)}. Whole rupees.`} error={error?.fields.amount} />
      ) : (
        <View style={{ gap: 6 }}>
          <ChipGroup label="Percent off the listed price" options={PERCENTS} value={percent == null ? [] : [percent]} onChange={(v) => changed(setPercent)(v[0] ?? null)} format={(p) => `${p}% off`} />
          {percent != null ? <AppText tone="muted" size={13}>Your offer: {formatRupees(paise)}</AppText> : null}
        </View>
      )}
      <Button title="Send offer" disabled={!ready} loading={make.isPending} onPress={send} />
      {error && !error.fields.amount ? <AppText tone="danger" size={12} accessibilityRole="alert">{error.message}</AppText> : null}
      <AppText tone="muted" size={12}>The seller can accept, counter or decline. Offers expire after {expiryText(listing.bargaining.expiryMinutes)} with no reply.</AppText>
    </Card>
  );
}

const expiryText = (m: number): string => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`);
