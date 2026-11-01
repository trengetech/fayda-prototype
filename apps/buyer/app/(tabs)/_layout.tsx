import { useBuyerNegotiations, useBuyerOrders } from '@fayda/api-client';
import { TabBar, useTheme, type TabItem } from '@fayda/ui';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { tabHeader } from '../../src/header';

/** The five places a buyer lives (same tabs and icons as the prototype). Counts come from data already fetched elsewhere. */
export default function TabsLayout() {
  const { colors } = useTheme();
  const replies = (useBuyerNegotiations().data?.items ?? []).filter((n) => n.canRespond).length;
  const orderUnread = useBuyerOrders().data?.unread ?? 0;
  const tabs: TabItem[] = [
    { key: 'index', label: 'Home', icon: 'home' },
    { key: 'search', label: 'Search', icon: 'search' },
    { key: 'offers', label: 'Offers', icon: 'tag', count: replies },
    { key: 'orders', label: 'Orders', icon: 'box', count: orderUnread },
    { key: 'profile', label: 'Profile', icon: 'user' },
  ];
  return (
    <Tabs
      screenOptions={{ headerShown: false, header: tabHeader }}
      tabBar={({ state, navigateToTab, insets }) => (
        <View style={{ paddingBottom: insets.bottom, backgroundColor: colors.surface }}>
          <TabBar tabs={tabs} current={state.routes[state.index]?.name ?? 'index'} onSelect={(name) => { const r = state.routes.find((x) => x.name === name); if (r) navigateToTab(r.key); }} />
        </View>
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="offers" options={{ headerShown: true, title: 'My offers' }} />
      <Tabs.Screen name="orders" options={{ headerShown: true, title: 'My orders' }} />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
