import { useApiClient } from '@fayda/api-client';
import type { BuyerListing } from '@fayda/contracts/schemas';
import { AppText, Button, useTheme } from '@fayda/ui';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Image, ScrollView, View, useWindowDimensions } from 'react-native';

type Item = BuyerListing['media'][number];

/** Mounted only after the buyer taps Play, so a page never holds more than one video player. */
function VideoSlide({ uri, size }: { uri: string; size: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: size, height: size }} accessibilityLabel="Video player" />;
}

/** Swipe through the listing's photos and videos. A video shows its cover photo until the buyer plays it. */
export function MediaCarousel({ media, title }: { media: Item[]; title: string }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<number | null>(null);

  if (!media.length)
    return (
      <View style={{ width, height: width * 0.6, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
        <AppText tone="muted">No photos yet</AppText>
      </View>
    );
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
          setPlaying(null); // swiping away stops a video
        }}
      >
        {media.map((m, i) => {
          const cover = m.kind === 'image' ? m.url : m.posterUrl;
          return (
            <View key={m.url} style={{ width, height: width, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              {m.kind === 'video' && playing === i ? (
                <VideoSlide uri={client.resolveUrl(m.url)} size={width} />
              ) : (
                <>
                  {cover ? (
                    <Image source={{ uri: client.resolveUrl(cover) }} style={{ width, height: width }} resizeMode="cover" accessibilityRole="image" accessibilityLabel={`${m.kind === 'video' ? 'Video cover' : 'Photo'} ${i + 1} of ${media.length}: ${title}`} accessibilityIgnoresInvertColors />
                  ) : null}
                  {m.kind === 'video' ? (
                    <View style={{ position: 'absolute' }}>
                      <Button title="Play video" variant="dark" onPress={() => setPlaying(i)} />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
      {media.length > 1 ? (
        <AppText tone="muted" size={12} style={{ textAlign: 'center', marginTop: 6 }}>{index + 1} / {media.length}</AppText>
      ) : null}
    </View>
  );
}
