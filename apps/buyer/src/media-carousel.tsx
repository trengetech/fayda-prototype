import { useApiClient } from '@fayda/api-client';
import type { BuyerListing } from '@fayda/contracts/schemas';
import { AppText, Button, Chip, ChipRow, useTheme } from '@fayda/ui';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRef, useState } from 'react';
import { Image, ScrollView, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';

type Item = BuyerListing['media'][number];

/** Mounted only after the buyer taps Play, so a page never holds more than one video player. */
function VideoSlide({ uri, size, height }: { uri: string; size: number; height: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: size, height }} accessibilityLabel="Video player" />;
}

/** Swipe through the listing's photos and videos. A video shows its cover photo until the buyer plays it. */
export function MediaCarousel({ media, title }: { media: Item[]; title: string }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<number | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const height = Math.round((width * 5) / 4); // 4:5, as in the prototype
  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
    setPlaying(null);
  };

  if (!media.length)
    return (
      <View style={{ width, height: width * 0.6, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
        <AppText tone="muted">No photos yet</AppText>
      </View>
    );
  return (
    <View>
      <View>
      <ScrollView
        ref={scroller}
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
            <View key={m.url} style={{ width, height, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
              {m.kind === 'video' && playing === i ? (
                <VideoSlide uri={client.resolveUrl(m.url)} size={width} height={height} />
              ) : (
                <>
                  {cover ? (
                    <Image source={{ uri: client.resolveUrl(cover) }} style={{ width, height }} resizeMode="cover" accessibilityRole="image" accessibilityLabel={`${m.kind === 'video' ? 'Video cover' : 'Photo'} ${i + 1} of ${media.length}: ${title}`} accessibilityIgnoresInvertColors />
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
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 8, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
          {media.map((_, i) => <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.5)' }} />)}
        </View>
      ) : null}
      </View>
      {media.length > 1 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <ChipRow>
            {media.map((m, i) => <Chip key={m.url} label={`${m.kind === 'video' ? 'Video' : 'Photo'} ${i + 1}`} selected={i === index} onPress={() => goTo(i)} />)}
          </ChipRow>
        </View>
      ) : null}
    </View>
  );
}
