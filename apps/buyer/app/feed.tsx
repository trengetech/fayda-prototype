import { useBuyerFeed } from '@fayda/api-client';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { FeedItem } from '../src/feed-card';
import { useImpressionReporter } from '../src/impressions';
import { ReelsPager } from '../src/reels';

type Scope = 'FOR_YOU' | 'FOLLOWING';
const TABS: { scope: Scope; label: string }[] = [
  { scope: 'FOR_YOU', label: 'For You' },
  { scope: 'FOLLOWING', label: 'Following' },
];

/**
 * Home feed: full-screen reels (D9). For You is every live listing, newest first; Following is only the shops the
 * buyer follows. Buy and Make offer open the product page (Make offer with the offer sheet already open).
 */
export default function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('FOR_YOU');
  const [muted, setMuted] = useState(true);
  const feed = useBuyerFeed({ scope });
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
          key={scope}
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

      {/* The bars sit over the picture, so each control has its own dark chip and stays readable on any photo. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, left: 8, right: 8, gap: 8 }}>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to home" onPress={() => router.back()} style={chip}><AppText weight="bold" size={13} style={{ color: '#fff' }}>‹ Home</AppText></Pressable>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn sound on' : 'Turn sound off'} onPress={() => setMuted((m) => !m)} style={chip}><AppText weight="bold" size={13} style={{ color: '#fff' }}>{muted ? 'Sound off' : 'Sound on'}</AppText></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Search" onPress={() => router.push('/search' as never)} style={chip}><AppText weight="bold" size={13} style={{ color: '#fff' }}>Search</AppText></Pressable>
          </View>
        </View>
        <View pointerEvents="box-none" style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {TABS.map((t) => (
            <Pressable key={t.scope} accessibilityRole="tab" accessibilityState={{ selected: scope === t.scope }} accessibilityLabel={t.label} onPress={() => setScope(t.scope)} style={[chip, scope === t.scope ? { backgroundColor: colors.accent } : null]}>
              <AppText weight="bold" size={13} style={{ color: '#fff' }}>{t.label}</AppText>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const chip = { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 } as const;
