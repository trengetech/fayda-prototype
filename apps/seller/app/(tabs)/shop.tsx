import { useApiClient, useSellerRecord, useSellerReviews } from '@fayda/api-client';
import { useQuery } from '@tanstack/react-query';
import { AppText, Badge, Button, Card, ListRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { AccountCard } from '../../src/account-card';
import { SHOW_GALLERY } from '../../src/config';
import { useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, View } from 'react-native';
import { CopyButton } from '../../src/copy';
import { openLink } from '../../src/links';
import { formatDuration } from '../../src/orders';


const Stars = ({ n }: { n: number }) => <AppText accessibilityLabel={`${n} out of 5 stars`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</AppText>;

/** The shop as buyers see it, the seller's public order record, and the reviews buyers have left. */
export default function ShopScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const client = useApiClient();
  const profile = useQuery({ queryKey: ['seller-profile', client.baseUrl], queryFn: () => client.getSellerProfile() });
  const record = useSellerRecord();
  const reviews = useSellerReviews();
  const [note, setNote] = useState<string | null>(null);
  const [copyUrl, setCopyUrl] = useState<string | null>(null);
  const p = profile.data;
  const r = record.data;
  const refresh = () => void Promise.all([profile.refetch(), record.refetch(), reviews.refetch()]);
  const open = (url: string, what: string) =>
    void openLink(url, `Can’t open ${what} here. The link is ${url}.`).then((n) => {
      setNote(n);
      setCopyUrl(n ? url : null);
    });

  if (profile.isPending) return <View style={{ flex: 1, padding: 16 }}><ActivityIndicator color={colors.accent} /></View>;
  if (profile.isError || !p)
    return (
      <View style={{ flex: 1, padding: 16, gap: 8 }}>
        <AppText weight="bold">Can’t load your shop</AppText>
        <AppText tone="muted">{profile.error?.message}</AppText>
        <Button title="Try again" onPress={refresh} />
      </View>
    );
  const contactModes = [p.contact.phone ? 'Phone' : null, p.contact.whatsapp ? 'WhatsApp' : null].filter(Boolean).join(' and ');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={profile.isRefetching} onRefresh={refresh} />}>
      <AppText weight="extrabold" size={20}>{p.name}</AppText>
      <AppText tone="muted">{p.area}, {p.city}</AppText>

      <Card>
        <AppText weight="bold">What buyers see</AppText>
        <AppText size={13}>Confirms payment within {p.sla.confirmHours} h · ships within {p.sla.shipDays} {p.sla.shipDays === 1 ? 'day' : 'days'}</AppText>
        <AppText size={13}>Sells: {p.categories.join(', ')}</AppText>
        <AppText size={13}>Contact on open orders: {contactModes || 'none set'}</AppText>
        <View style={{ gap: 8 }}>
          <Button title="Shop location (Google Maps)" variant="outline" onPress={() => open(p.mapsUrl, 'Maps')} />
          {p.googleProfileUrl ? <Button title="Google profile" variant="outline" onPress={() => open(p.googleProfileUrl!, 'your Google profile')} /> : null}
          {p.socialUrl ? <Button title="Instagram / Facebook" variant="outline" onPress={() => open(p.socialUrl!, 'your social page')} /> : null}
        </View>
        {note ? <AppText tone="danger" size={12}>{note}</AppText> : null}
        {note && copyUrl ? <CopyButton value={copyUrl} title="Copy link" /> : null}
      </Card>

      <Card>
        <AppText weight="bold">Your public order record</AppText>
        {record.isPending ? <ActivityIndicator color={colors.accent} /> : record.isError || !r ? (
          <><AppText tone="muted" size={13}>Can’t load your record.</AppText><Button title="Try again" onPress={() => void record.refetch()} /></>
        ) : (
          <>
            <AppText>{r.completed} delivered of {r.orders} orders</AppText>
            <AppText size={13}>Median time to confirm: {r.medianConfirmMs != null ? formatDuration(r.medianConfirmMs) : 'no confirmed orders yet'} (you declare {p.sla.confirmHours} h)</AppText>
            <AppText size={13}>Cancelled: {r.cancelled} · Unconfirmed (expired): {r.expired}</AppText>
            <AppText size={13}>{r.rating != null ? `Rating ${r.rating.toFixed(1)} ★ (${r.reviewCount})` : 'No reviews yet'}</AppText>
            <AppText tone="faint" size={12}>Buyers see this record on your shop.</AppText>
          </>
        )}
      </Card>

      <AppText weight="bold" size={16}>Reviews</AppText>
      {reviews.isPending ? <ActivityIndicator color={colors.accent} /> : reviews.isError ? (
        <Card><AppText tone="muted" size={13}>Can’t load reviews.</AppText><Button title="Try again" onPress={() => void reviews.refetch()} /></Card>
      ) : reviews.data.items.length ? (
        reviews.data.items.map((v) => (
          <Card key={v.id}>
            <Stars n={v.rating} />
            {v.text ? <AppText>{v.text}</AppText> : null}
            {v.media.length ? (
              <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
                {v.media.map((m) => <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 72, height: 72, borderRadius: 10 }} accessibilityLabel={m.kind === 'video' ? 'Review video' : 'Review photo'} accessibilityIgnoresInvertColors />)}
              </ScrollView>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <AppText tone="muted" size={12}>{v.buyerName} · {v.listingTitle}</AppText>
              <Badge label="Verified order" tone="success" />
            </View>
          </Card>
        ))
      ) : (
        <Card><AppText tone="muted" size={13}>No reviews yet.</AppText></Card>
      )}

      <AppText weight="extrabold" size={15} style={{ marginTop: 8 }}>More</AppText>
      <View style={{ marginHorizontal: -16 }}>
        <ListRow icon="bell" title="Notifications" onPress={() => router.push('/notifications' as never)} />
        <ListRow icon="msg" title="Messages" onPress={() => router.push('/messages' as never)} />
        <ListRow icon="shield" title="Blocked people" onPress={() => router.push('/blocked' as never)} />
        <ListRow icon="clock" title="App status" subtitle="Server connection and environment" onPress={() => router.push('/status' as never)} />
        {SHOW_GALLERY ? <ListRow icon="image" title="Design-system gallery (dev)" onPress={() => router.push('/gallery' as never)} last /> : null}
      </View>
      <AccountCard />
    </ScrollView>
  );
}
