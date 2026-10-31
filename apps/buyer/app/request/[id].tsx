import { useApiClient, useBuyerRequest, useRequestAction } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, Screen, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import { newKey } from '../../src/orders';
import { ratingLine } from '../../src/stars';

/** One request and the sellers' replies. "I want this" opens a chat with that seller; "Not for me" tells them no. */
export default function RequestScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useApiClient();
  const q = useBuyerRequest(id ?? null);
  const act = useRequestAction();
  const [error, setError] = useState<string | null>(null);
  const key = useRef(newKey());

  if (q.isPending) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your request…</AppText></View></Screen>;
  if (q.isError)
    return (
      <Screen>
        <AppText weight="bold">Can’t load this request</AppText>
        <AppText tone="muted">{q.error.message}</AppText>
        <Button title="Try again" onPress={() => void q.refetch()} />
      </Screen>
    );
  const r = q.data;
  const run = (a: Parameters<typeof act.mutate>[0], then?: (threadId: string | null) => void) => {
    setError(null);
    act.mutate(
      { ...a, idempotencyKey: key.current },
      {
        onSuccess: (updated) => {
          key.current = newKey();
          if (then && a.action === 'want') then(updated.responses.find((x) => x.id === (a as { responseId: string }).responseId)?.threadId ?? null);
        },
        onError: (e) => setError(describeError(e).message),
      },
    );
  };

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <AppText weight="extrabold" size={20}>{r.title}</AppText>
        <AppText tone="muted" size={13}>{r.category}{r.size ? ` · size ${r.size}` : ''}{r.budget != null ? ` · budget ${formatRupees(r.budget)}` : ''}</AppText>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Badge label={r.status === 'OPEN' ? 'Open' : r.status === 'CLOSED' ? 'Closed' : 'Expired'} tone={r.status === 'OPEN' ? 'accent' : 'info'} />
          <AppText tone="muted" size={12}>Sent to {r.reachedCount} {r.reachedCount === 1 ? 'seller' : 'sellers'}</AppText>
        </View>
        {r.description ? <AppText>{r.description}</AppText> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {r.media.map((m) => <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 80, height: 80, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors accessibilityLabel="Photo you sent" />)}
      </View>

      <AppText weight="bold">Replies ({r.responses.length})</AppText>
      {r.responses.length === 0 ? <Card><AppText tone="muted">No replies yet. Sellers who sell this category have been told.</AppText></Card> : null}
      {r.responses.map((x) => (
        <Card key={x.id}>
          <AppText weight="bold">{x.seller.name}</AppText>
          <AppText tone="muted" size={12}>{x.seller.area} · {ratingLine(x.seller.rating, x.seller.reviewCount)}</AppText>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {x.media.map((m) => <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors accessibilityLabel={`Photo from ${x.seller.name}`} />)}
          </View>
          {x.price != null ? <AppText weight="extrabold">{formatRupees(x.price)}</AppText> : null}
          {x.text ? <AppText>{x.text}</AppText> : null}
          {x.status === 'SENT' ? (
            <View style={{ gap: 8 }}>
              <Button title="I want this" loading={act.isPending} onPress={() => run({ action: 'want', responseId: x.id }, (tid) => tid && router.push(`/chat/${tid}` as never))} />
              <Button title="Not for me" variant="outline" loading={act.isPending} onPress={() => run({ action: 'decline', responseId: x.id })} />
            </View>
          ) : x.status === 'WANTED' ? (
            <>
              <Badge label="You want this" tone="success" />
              {x.threadId ? <Button title="Open chat" variant="outline" onPress={() => router.push(`/chat/${x.threadId}` as never)} /> : null}
              {x.listingId ? <Button title="View the listing" variant="outline" onPress={() => router.push(`/listing/${x.listingId}` as never)} /> : null}
            </>
          ) : (
            <Badge label="Not for me" tone="info" />
          )}
        </Card>
      ))}
      {r.status === 'OPEN' ? <Button title="Close request" variant="outline" loading={act.isPending} onPress={() => run({ action: 'close', requestId: r.id })} /> : null}
      {error ? <AppText tone="danger" size={12} accessibilityRole="alert">{error}</AppText> : null}
    </Screen>
  );
}
