import { useApiClient } from '@fayda/api-client';
import type { BuyerFeed } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Icon, RatingChip, Tag, useTheme } from '@fayda/ui';
import { Image, Pressable, View } from 'react-native';

export type FeedItem = BuyerFeed['items'][number];

/**
 * One listing as a tile in a two-column grid (search results, saved items, a shop page): a tall picture, the title, the
 * price with an "Offers" tag, the shop and its rating. Reels have their own full-screen card.
 */
export function FeedCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={onOpen} style={{ flex: 1, gap: 6 }}>
      <View style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surface2 }}>
        {item.coverUrl ? (
          <Image source={{ uri: client.resolveUrl(item.coverUrl) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityRole="image" accessibilityLabel={`Photo of ${item.title}`} accessibilityIgnoresInvertColors />
        ) : null}
        {item.soldOut ? <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}><AppText weight="bold" size={10} style={{ color: '#fff' }}>Sold out</AppText></View> : null}
        {item.hasVideo ? <View style={{ position: 'absolute', right: 8, top: 8, backgroundColor: 'rgba(0,0,0,0.45)', padding: 5, borderRadius: 99 }}><Icon name="video" size={13} color="#fff" /></View> : null}
      </View>
      <AppText weight="extrabold" size={12} numberOfLines={1}>{item.title}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AppText weight="extrabold" size={14}>{formatRupees(item.price)}</AppText>
        {!item.soldOut && item.acceptsOffers ? <Tag label="Offers" /> : null}
      </View>
      <AppText tone="muted" size={11} numberOfLines={1}>{item.seller.name}</AppText>
      <RatingChip rating={item.seller.rating} count={item.seller.reviewCount} />
    </Pressable>
  );
}
