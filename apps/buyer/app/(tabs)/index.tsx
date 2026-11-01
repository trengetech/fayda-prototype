import { useBuyerFeed, useFeedFacets, useUnreadCount } from '@fayda/api-client';
import { AppText, Button, Card, Icon, IconButton, Segmented, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import type { FeedItem } from '../../src/feed-card';
import { useImpressionReporter } from '../../src/impressions';
import { ReelsPager } from '../../src/reels';

type Scope = 'FOR_YOU' | 'FOLLOWING';
const TABS = [
  { key: 'FOR_YOU', label: 'For you' },
  { key: 'FOLLOWING', label: 'Following' },
] as const;

/**
 * Home feed: full-screen reels (D9). For You is every live listing, newest first; Following is only the shops the
 * buyer follows. Buy and Make offer open the product page (Make offer with the offer sheet already open).
 */
export default function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('FOR_YOU');
  const [muted, setMuted] = useState(true);
  const [category, setCategory] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const facets = useFeedFacets();
  const unread = useUnreadCount('buyer').data?.unread ?? 0;
  const feed = useBuyerFeed({ scope, ...(category ? { category } : {}) });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const reportShown = useImpressionReporter(scope, feed.data?.pages[0]?.ranker);
  const { fetchNextPage, isFetchNextPageError: moreFailed } = feed; // read before the early returns narrow `feed`

  const open = (item: FeedItem, offer: boolean) => router.push((offer ? `/listing/${item.id}?offer=1` : `/listing/${item.id}`) as never);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {feed.isPending ? (
        <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16, paddingTop: 72 }}>
          <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading listings…</AppText></View></Card>
        </View>
      ) : feed.isError ? (
        <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16, paddingTop: 72 }}>
          <Card>
            <AppText weight="bold">Can’t load listings</AppText>
            <AppText tone="muted" size={13}>{feed.error.message}</AppText>
            <Button title="Try again" onPress={() => void feed.refetch()} />
          </Card>
        </View>
      ) : (
        <ReelsPager
          key={`${scope}:${category ?? ''}`}
          items={items}
          muted={muted}
          onOpen={open}
          onShown={(item, position) => reportShown(item.id, position)}
          onOpenShop={(i) => router.push(`/shop/${i.seller.handle}` as never)}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void fetchNextPage();
          }}
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => void feed.refetch()}
          footer={feed.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Button title="Couldn’t load more. Try again" variant="outline" onPress={() => void fetchNextPage()} /> : null}
          empty={
            <Card>
              {scope === 'FOLLOWING' ? (
                <>
                  <AppText weight="bold">Nothing from shops you follow yet</AppText>
                  <AppText tone="muted" size={13}>Follow shops from For You and their new listings show up here.</AppText>
                  <Button title="Go to For You" onPress={() => setScope('FOR_YOU')} />
                </>
              ) : (
                <>
                  <AppText weight="bold">Nothing listed yet</AppText>
                  <AppText tone="muted" size={13}>Sellers haven’t published anything yet. Pull down to check again.</AppText>
                  <Button title="Ask sellers for something" variant="outline" onPress={() => router.push('/request/new' as never)} />
                </>
              )}
            </Card>
          }
        />
      )}

      {/* The bars sit over the picture (as in the prototype): a see-through segmented control, a category pill and the bell. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, left: 12, right: 12, gap: 10 }}>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Segmented glass value={scope} onChange={setScope} options={TABS} /></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Category: ${category ?? 'All'}`} onPress={() => setMenuOpen(true)} style={{ height: 38, paddingHorizontal: 12, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.16)', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <AppText weight="bold" size={13} style={{ color: '#fff' }}>{category ? category.split(' ')[0] : 'All'}</AppText>
            <Icon name="chevronDown" size={14} color="#fff" />
          </Pressable>
          <IconButton glass icon="bell" label="Notifications" count={unread} size={18} onPress={() => router.push('/notifications' as never)} />
        </View>
        <View pointerEvents="box-none" style={{ alignItems: 'flex-end', gap: 8 }}>
          <IconButton glass icon="search" label="Search" size={18} onPress={() => router.push('/search' as never)} />
          <IconButton glass icon={muted ? 'mute' : 'volume'} label={muted ? 'Turn sound on' : 'Turn sound off'} size={18} onPress={() => setMuted((m) => !m)} />
        </View>
      </View>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable accessibilityLabel="Close categories" onPress={() => setMenuOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(10,11,14,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, gap: 4 }}>
            <AppText weight="extrabold" size={17} style={{ marginBottom: 8 }}>Category</AppText>
            {['All', ...(facets.data?.categories ?? [])].map((c) => {
              const on = (category ?? 'All') === c;
              return (
                <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { setCategory(c === 'All' ? null : c); setMenuOpen(false); }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <AppText weight={on ? 'extrabold' : 'bold'} tone={on ? 'accent' : 'ink'}>{c}</AppText>
                  {on ? <Icon name="check" size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
