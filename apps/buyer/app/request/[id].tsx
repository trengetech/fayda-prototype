import { useApiClient, useBuyerRequest, useRequestAction } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { ActionBar, AppText, Avatar, Badge, Button, ButtonRow, Card, EmptyState, RatingChip, Screen, SectionTitle, Thumb, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import { newKey } from '../../src/orders';

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

  const firstPhoto = r.media[0];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Thumb size={72} source={firstPhoto ? { uri: client.resolveUrl(firstPhoto.url) } : null} label="Photo you sent" />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText weight="extrabold" size={16}>{r.title}</AppText>
            <AppText tone="muted" size={12}>{r.category}{r.size ? ` · size ${r.size}` : ''}{r.budget != null ? ` · budget ${formatRupees(r.budget)}` : ''}</AppText>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
              <Badge label={r.status === 'OPEN' ? 'Open' : r.status === 'CLOSED' ? 'Closed' : 'Expired'} tone={r.status === 'OPEN' ? 'accent' : 'info'} />
              <AppText tone="muted" size={11}>Sent to {r.reachedCount} {r.reachedCount === 1 ? 'seller' : 'sellers'}</AppText>
            </View>
          </View>
        </View>
        {r.description ? <AppText size={13}>{r.description}</AppText> : null}
        {r.media.length > 1 ? (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {r.media.map((m) => <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 80, height: 80, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors accessibilityLabel="Photo you sent" />)}
          </View>
        ) : null}

        <SectionTitle>Replies ({r.responses.length})</SectionTitle>
        {r.responses.length === 0 ? <EmptyState icon="megaphone" title="No replies yet" body="Sellers who sell this category have been told. Replies with photos appear here." /> : null}
        {r.responses.map((x) => (
          <Card key={x.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={x.seller.name} />
              <View style={{ flex: 1, gap: 1 }}>
                <AppText weight="extrabold">{x.seller.name}</AppText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <RatingChip rating={x.seller.rating} count={x.seller.reviewCount} />
                  <AppText tone="muted" size={11}>{x.seller.area}{x.seller.rating == null ? ' · No reviews yet' : ''}</AppText>
                </View>
              </View>
              {x.price != null ? <AppText weight="extrabold">{formatRupees(x.price)}</AppText> : null}
            </View>
            {x.media.length ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {x.media.map((m) => <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors accessibilityLabel={`Photo from ${x.seller.name}`} />)}
              </View>
            ) : null}
            {x.text ? <AppText>{x.text}</AppText> : null}
            {x.status === 'SENT' ? (
              <ButtonRow>
                <Button title="Not for me" variant="outline" loading={act.isPending} onPress={() => run({ action: 'decline', responseId: x.id })} />
                <Button title="I want this" loading={act.isPending} onPress={() => run({ action: 'want', responseId: x.id }, (tid) => tid && router.push(`/chat/${tid}` as never))} />
              </ButtonRow>
            ) : x.status === 'WANTED' ? (
              <>
                <Badge label="You want this" tone="success" />
                {x.threadId ? <Button title={x.listingId ? 'Open chat · listing shared' : 'Open chat with seller'} icon="msg" variant="dark" onPress={() => router.push(`/chat/${x.threadId}` as never)} /> : null}
                {x.listingId ? <Button title="View the listing" variant="outline" onPress={() => router.push(`/listing/${x.listingId}` as never)} /> : null}
              </>
            ) : (
              <AppText tone="muted" size={12}>You passed on this.</AppText>
            )}
          </Card>
        ))}
        {error ? <AppText tone="danger" size={12} accessibilityRole="alert">{error}</AppText> : null}
      </Screen>
      {r.status === 'OPEN' ? (
        <ActionBar>
          <Button title="Close request" variant="outline" loading={act.isPending} onPress={() => run({ action: 'close', requestId: r.id })} />
        </ActionBar>
      ) : null}
    </View>
  );
}
