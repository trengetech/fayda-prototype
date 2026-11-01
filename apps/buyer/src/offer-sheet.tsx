import { useApiClient, useMakeOffer } from '@fayda/api-client';
import type { BuyerListing } from '@fayda/contracts/schemas';
import { formatRupees, platformFloor } from '@fayda/domain';
import { AmountInput, AppText, Button, Chip, Sheet, Thumb, amountFromInput, describeError, type AmountMode } from '@fayda/ui';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { newAttemptKey } from './offers';

/**
 * The "Make an offer" sheet. The amount is typed in rupees, or as a percent off the listed price. The seller's lowest
 * price is never sent to this screen, so nothing here can hint at it. Offers are always private (B-1), so there is no
 * public/private choice.
 */
export function OfferSheet({ listing, visible, initialVariantId, onClose, onSent }: { listing: BuyerListing; visible: boolean; initialVariantId?: string | null | undefined; onClose: () => void; onSent: (negotiationId: string) => void }) {
  const client = useApiClient();
  const available = listing.variants.filter((v) => v.available);
  const [variantId, setVariantId] = useState<string | null>(initialVariantId ?? (available.length === 1 ? (available[0]?.id ?? null) : null));
  const [mode, setMode] = useState<AmountMode>('inr');
  const [value, setValue] = useState('');
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const key = useRef(newAttemptKey());
  const make = useMakeOffer();

  const rupees = amountFromInput(mode, value, listing.price);
  const paise = rupees != null && Number.isFinite(rupees) && rupees > 0 ? rupees * 100 : 0;
  const ready = !!variantId && paise > 0;
  const cover = listing.media[0];
  const coverUri = cover ? client.resolveUrl(cover.kind === 'video' ? (cover.posterUrl ?? '') : cover.url) : null;

  const send = () => {
    if (!variantId) return setError({ message: 'Choose a size first.', fields: {} });
    if (paise <= 0) return setError({ message: 'Enter your offer.', fields: {} });
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
  const fresh = () => {
    key.current = newAttemptKey();
    setError(null);
  };

  return (
    <Sheet
      visible={visible}
      title="Make an offer"
      onClose={onClose}
      footer={<Button title={paise > 0 ? `Send offer · ${formatRupees(paise)}` : 'Send offer'} size="lg" disabled={!ready} loading={make.isPending} onPress={send} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Thumb size={56} source={coverUri ? { uri: coverUri } : null} label={listing.title} />
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" numberOfLines={1}>{listing.title}</AppText>
          <AppText tone="muted" size={12}>Listed at {formatRupees(listing.price)} · {listing.seller.name}</AppText>
        </View>
      </View>
      {listing.variants.length > 1 ? (
        <View style={{ gap: 6 }}>
          <AppText weight="bold" size={13}>Size</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {listing.variants.map((v) => <Chip key={v.id} label={v.label} selected={variantId === v.id} disabled={!v.available} onPress={() => { fresh(); setVariantId(v.id); }} />)}
          </View>
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        <AppText weight="bold" size={13}>Your offer</AppText>
        <AmountInput listPrice={listing.price} value={value} onChange={(v) => { fresh(); setValue(v); }} mode={mode} onMode={(m) => { fresh(); setMode(m); setValue(''); }} invalid={!!error} label="Your offer" />
        {error ? (
          <AppText tone="danger" size={12} accessibilityRole="alert">{error.fields.amount ?? error.message}</AppText>
        ) : (
          <AppText tone="muted" size={12}>Offer below {formatRupees(listing.price)}. Offers under {formatRupees(platformFloor(listing.price))} aren’t allowed. The seller has {expiryText(listing.bargaining.expiryMinutes)} to respond.</AppText>
        )}
      </View>
    </Sheet>
  );
}

const expiryText = (m: number): string => (m < 60 ? `${m} min` : `${m / 60} h`);
