import { useApiClient } from '@fayda/api-client';
import type { BuyerFeed } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Card, useTheme } from '@fayda/ui';
import { Image, Pressable, View } from 'react-native';

export type FeedItem = BuyerFeed['items'][number];

/** One listing as a card in a list (search results, a shop page). Reels have their own full-screen card. */
export function FeedCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={onOpen} style={{ gap: 8 }}>
        {item.coverUrl ? (
          <Image source={{ uri: client.resolveUrl(item.coverUrl) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: colors.border }} accessibilityRole="image" accessibilityLabel={`Photo of ${item.title}`} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: colors.border }} />
        )}
        <AppText weight="bold" numberOfLines={2}>{item.title}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AppText weight="extrabold">{formatRupees(item.price)}</AppText>
          {item.soldOut ? <Badge label="Sold out" tone="danger" /> : item.acceptsOffers ? <Badge label="Open to offers" tone="accent" /> : null}
          {item.hasVideo ? <Badge label="Video" tone="info" /> : null}
        </View>
        <AppText tone="muted" size={12}>{item.seller.name} · {item.seller.area}</AppText>
      </Pressable>
    </Card>
  );
}
