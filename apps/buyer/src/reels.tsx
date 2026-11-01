import { useApiClient } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { AppText, Avatar, Badge, Button, Icon } from '@fayda/ui';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import type { FeedItem } from './feed-card';
import { FollowButton } from './follow-button';
import { ReelRail } from './social';

/** True while this screen is the one in front (not covered by another screen). */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}

/** True while the app is in the foreground. A reel must not keep playing (and using data) from the background. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * One video player. Mounted only for the reel on screen and the one after it, so at most two players exist: the
 * active one plays, the next one is created early and sits paused with its source loading, so a swipe starts at once.
 */
function ReelVideo({ uri, playing, muted }: { uri: string; playing: boolean; muted: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = muted;
  });
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [player, playing]);
  return <VideoView player={player} nativeControls={false} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel="Video" />;
}

const SCRIM = 'rgba(0,0,0,0.55)';

/** The prototype's dark fade: light at the top, clear in the middle, dark at the bottom so white text is readable on any photo. */
function Shade() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity="0.45" />
            <Stop offset="0.22" stopColor="#000" stopOpacity="0" />
            <Stop offset="0.48" stopColor="#000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.78" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shade)" />
      </Svg>
    </View>
  );
}

function GlassBadge({ label }: { label: string }) {
  return (
    <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' }}>
      <AppText weight="extrabold" size={11} style={{ color: '#fff' }}>{label}</AppText>
    </View>
  );
}

function ReelCard({ item, height, active, near, playing, muted, onTogglePlay, onOpen, onOpenShop }: { item: FeedItem; height: number; active: boolean; near: boolean; playing: boolean; muted: boolean; onTogglePlay: () => void; onOpen: (offer: boolean) => void; onOpenShop: () => void }) {
  const client = useApiClient();
  const cover = item.coverUrl ? client.resolveUrl(item.coverUrl) : null;
  return (
    <View style={{ height, backgroundColor: '#000' }} testID={`reel-${item.id}`}>
      {cover ? <Image source={{ uri: cover }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityRole="image" accessibilityLabel={`Photo of ${item.title}`} accessibilityIgnoresInvertColors /> : null}
      {item.video && near ? <ReelVideo uri={client.resolveUrl(item.video.url)} playing={active && playing} muted={muted} /> : null}
      {item.video ? <Pressable accessibilityRole="button" accessibilityLabel={active && playing ? 'Pause video' : 'Play video'} onPress={onTogglePlay} style={StyleSheet.absoluteFill} /> : null}
      {active && item.video && !playing ? (
        <View pointerEvents="none" style={{ ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: SCRIM, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8 }}><AppText weight="bold" style={{ color: '#fff' }}>Paused</AppText></View>
        </View>
      ) : null}
      <Shade />
      <View pointerEvents="box-none" style={{ position: 'absolute', right: 10, bottom: 168 }}>
        <ReelRail item={item} onComments={() => onOpen(false)} />
      </View>
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open shop ${item.seller.name}`} onPress={onOpenShop} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <Avatar name={item.seller.name} size={34} light />
            <View style={{ flexShrink: 1 }}>
              <AppText weight="extrabold" numberOfLines={1} style={{ color: '#fff' }}>{item.seller.name}</AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                {item.seller.rating != null ? <><Icon name="star" size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={1.5} /><AppText weight="extrabold" size={12} style={{ color: '#fff' }}>{item.seller.rating.toFixed(1)}</AppText><AppText size={12} style={{ color: 'rgba(255,255,255,0.8)' }}>({item.seller.reviewCount})</AppText></> : <AppText size={12} style={{ color: 'rgba(255,255,255,0.8)' }} numberOfLines={1}>{item.seller.area}</AppText>}
              </View>
            </View>
          </Pressable>
          {item.ownShop ? <Badge label="Your shop" tone="info" /> : <FollowButton sellerId={item.seller.id} shopName={item.seller.name} following={item.following} onDark />}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => onOpen(false)} style={{ gap: 8 }}>
          <AppText weight="extrabold" size={16} numberOfLines={2} style={{ color: '#fff', marginRight: 64 }}>{item.title}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <AppText weight="extrabold" size={24} style={{ color: '#fff', letterSpacing: -0.4 }}>{formatRupees(item.price)}</AppText>
            {item.soldOut ? <Badge label="Sold out" tone="danger" /> : item.acceptsOffers ? <Badge label="Accepts offers" tone="accent" /> : <Badge label="Fixed price" tone="info" />}
            <GlassBadge label={item.category} />
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button title="Buy now" variant="outline" size="lg" disabled={item.soldOut || item.ownShop} accessibilityLabel={`Buy ${item.title}`} onPress={() => onOpen(false)} /></View>
          {item.acceptsOffers ? <View style={{ flex: 1 }}><Button title="Make offer" size="lg" disabled={item.soldOut || item.ownShop} accessibilityLabel={`Make an offer on ${item.title}`} onPress={() => onOpen(true)} /></View> : null}
        </View>
      </View>
    </View>
  );
}

/** What the list reports about which rows are on screen (the part this file reads). */
interface Viewable {
  item: unknown;
  isViewable: boolean;
  index?: number | null;
}

export interface ReelsPagerProps {
  items: FeedItem[];
  muted: boolean;
  onOpen: (item: FeedItem, offer: boolean) => void;
  onOpenShop: (item: FeedItem) => void;
  onEndReached: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  footer?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  /** A reel became the one on screen (for impressions). Called with its place in the list. */
  onShown?: (item: FeedItem, position: number) => void;
}

/**
 * Full-screen vertical reels, one per page. Exactly one reel is "active" (the one that is mostly on screen); only it
 * plays, and only while this screen is in front and the app is in the foreground. A tap on the picture pauses or
 * resumes it. Photo-only listings are shown as a full-screen photo.
 */
export function ReelsPager({ items, muted, onOpen, onOpenShop, onEndReached, refreshing, onRefresh, footer, empty, onShown }: ReelsPagerProps) {
  const [height, setHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pausedId, setPausedId] = useState<string | null>(null);
  const focused = useScreenFocused();
  const appActive = useAppActive();
  const activeIndex = Math.max(0, items.findIndex((i) => i.id === (activeId ?? items[0]?.id)));
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const onViewable = useRef(({ viewableItems }: { viewableItems: Viewable[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.item) {
      setActiveId((first.item as FeedItem).id);
      onShownRef.current?.(first.item as FeedItem, first.index ?? 0);
      setPausedId(null); // a new reel always starts playing
    }
  });
  const viewConfig = useRef({ itemVisiblePercentThreshold: 80 });

  return (
    <View testID="reels-container" style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {height > 0 ? (
        <FlatList
          testID="reels-list"
          data={items}
          keyExtractor={(i) => i.id}
          extraData={{ activeId, pausedId, muted, focused, appActive, height }}
          renderItem={({ item, index }) => (
            <ReelCard
              item={item}
              height={height}
              active={index === activeIndex}
              near={index === activeIndex || index === activeIndex + 1}
              playing={focused && appActive && pausedId !== item.id}
              muted={muted}
              onTogglePlay={() => setPausedId((p) => (p === item.id ? null : item.id))}
              onOpen={(offer) => onOpen(item, offer)}
              onOpenShop={() => onOpenShop(item)}
            />
          )}
          getItemLayout={(_d, index) => ({ length: height, offset: height * index, index })}
          pagingEnabled
          snapToInterval={height}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={3}
          removeClippedSubviews
          onViewableItemsChanged={onViewable.current}
          viewabilityConfig={viewConfig.current}
          onEndReachedThreshold={1.5}
          onEndReached={onEndReached}
          refreshing={refreshing}
          onRefresh={onRefresh}
          {...(empty ? { ListEmptyComponent: <View style={{ height, justifyContent: 'center', padding: 16 }}>{empty}</View> } : {})}
          {...(footer ? { ListFooterComponent: <View style={{ height: 96, alignItems: 'center', justifyContent: 'center', padding: 16 }}>{footer}</View> } : {})}
        />
      ) : (
        <ActivityIndicator style={{ flex: 1 }} />
      )}
    </View>
  );
}
