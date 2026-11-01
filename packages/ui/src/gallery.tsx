import { ScrollView, View } from 'react-native';
import { AppText, Badge, Button, Card, PrototypeBanner } from './components';
import { fontFamily } from './fonts';
import { Icon, iconNames } from './icon';
import { AppBar, Avatar, Chip, EmptyState, IconButton, ListRow, Segmented, StatTile, TabBar } from './parts';
import { ThemeProvider, useTheme } from './theme';
import { heights, palettes, radii, type Palette, type Scheme } from './tokens';

function Swatches() {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {(Object.keys(colors) as (keyof Palette)[]).map((k) => (
        <View key={k} style={{ width: 96 }}>
          <View style={{ height: 36, borderRadius: radii.sm, backgroundColor: colors[k], borderColor: colors.border, borderWidth: 1 }} />
          <AppText size={10} tone="muted">{k}</AppText>
          <AppText size={10} tone="faint">{colors[k]}</AppText>
        </View>
      ))}
    </View>
  );
}

function Parts() {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>{iconNames.map((n) => <View key={n} style={{ width: 52, alignItems: 'center', gap: 2 }}><Icon name={n} /><AppText size={9} tone="muted" numberOfLines={1}>{n}</AppText></View>)}</View>
      <AppBar title="App bar" onBack={() => undefined} right={<IconButton icon="bell" label="Notifications" count={3} />} />
      <View style={{ flexDirection: 'row', gap: 8 }}><Chip label="All" selected /><Chip label="Ethnic wear" /><Chip label="Sold out" disabled /></View>
      <Segmented value="a" onChange={() => undefined} options={[{ key: 'a', label: 'For you' }, { key: 'b', label: 'Following' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}><StatTile value="2179" label="Views" /><StatTile value="₹1,150" label="Confirmed sales" /></View>
      <ListRow icon="bookmark" title="Saved" subtitle="Listings you saved" onPress={() => undefined} count={2} />
      <View style={{ flexDirection: 'row', gap: 8 }}><Avatar name="Meher" /><Button title="New listing" icon="plus" size="sm" block={false} /></View>
      <EmptyState icon="heart" title="Follow shops to see them here" body="Tap Follow on any reel." />
      <TabBar current="home" onSelect={() => undefined} tabs={[{ key: 'home', label: 'Home', icon: 'home' }, { key: 'search', label: 'Search', icon: 'search' }, { key: 'offers', label: 'Offers', icon: 'tag', count: 1 }, { key: 'orders', label: 'Orders', icon: 'box', count: 1 }, { key: 'profile', label: 'Profile', icon: 'user' }]} />
    </View>
  );
}

function Panel({ scheme }: { scheme: Scheme }) {
  return (
    <ThemeProvider scheme={scheme}>
      <PanelBody scheme={scheme} />
    </ThemeProvider>
  );
}

function PanelBody({ scheme }: { scheme: Scheme }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radii.xl, borderColor: colors.divider, borderWidth: 1.5, overflow: 'hidden' }}>
      <PrototypeBanner />
      <View style={{ padding: 16, gap: 14 }}>
        <AppText weight="extrabold" size={20}>{scheme === 'light' ? 'Light' : 'Dark'} theme</AppText>

        <AppText weight="bold">Colours</AppText>
        <Swatches />
        <Parts />

        <AppText weight="bold">Type · Plus Jakarta Sans (bundled)</AppText>
        {(Object.keys(fontFamily) as (keyof typeof fontFamily)[]).map((w) => (
          <AppText key={w} weight={w} size={15}>{w} — Fayda ₹2,500 Hyderabad</AppText>
        ))}

        <AppText weight="bold">Buttons ({heights.btnLg} / {heights.btn} / {heights.btnSm} dp)</AppText>
        <Button title="Primary large" size="lg" />
        <Button title="Dark" variant="dark" />
        <Button title="Outline" variant="outline" />
        <Button title="Danger" variant="danger" />
        <Button title="Small ghost" variant="ghost" size="sm" />
        <Button title="Disabled" disabled />

        <AppText weight="bold">Badges</AppText>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Badge label="Online" tone="success" />
          <Badge label="Database down" tone="danger" />
          <Badge label="Info" tone="info" />
          <Badge label="Simulated" tone="accent" />
        </View>

        <AppText weight="bold">Radii</AppText>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {Object.entries(radii).filter(([k]) => k !== 'pill').map(([k, r]) => (
            <View key={k} style={{ alignItems: 'center', gap: 4 }}>
              <View style={{ width: 56, height: 56, borderRadius: r, backgroundColor: colors.accentTint2, borderColor: colors.accent, borderWidth: 1.5 }} />
              <AppText size={10} tone="muted">{k} {r}</AppText>
            </View>
          ))}
        </View>

        <Card>
          <AppText weight="bold">Card</AppText>
          <AppText tone="muted">Surface, divider border, {radii.lg} dp radius.</AppText>
        </Card>
      </View>
    </View>
  );
}

/** Dev-only gallery: both themes stacked, so tokens can be compared with the prototype at a glance. */
export function Gallery() {
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 16 }}>
      {(Object.keys(palettes) as Scheme[]).map((s) => <Panel key={s} scheme={s} />)}
    </ScrollView>
  );
}
