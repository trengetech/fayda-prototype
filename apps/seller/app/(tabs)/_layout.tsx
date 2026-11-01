import { useSellerNegotiations, useSellerOrders, useSellerRequests } from '@fayda/api-client';
import { TabBar, useTheme, type TabItem } from '@fayda/ui';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { tabHeader } from '../../src/header';

/** The six places a seller lives (same tabs and icons as the prototype). Counts are what needs a reply or a confirm. */
export default function TabsLayout() {
  const { colors } = useTheme();
  const waiting = useSellerNegotiations().data?.needsReply ?? 0;
  const toConfirm = useSellerOrders().data?.needsConfirm ?? 0;
  const newRequests = useSellerRequests().data?.newCount ?? 0;
  const tabs: TabItem[] = [
    { key: 'index', label: 'Home', icon: 'chart' },
    { key: 'listings', label: 'Listings', icon: 'list' },
    { key: 'offers', label: 'Offers', icon: 'tag', count: waiting },
    { key: 'requests', label: 'Requests', icon: 'megaphone', count: newRequests },
    { key: 'orders', label: 'Orders', icon: 'box', count: toConfirm },
    { key: 'shop', label: 'Shop', icon: 'store' },
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
      <Tabs.Screen name="listings" options={{ headerShown: true, title: 'My listings' }} />
      <Tabs.Screen name="offers" options={{ headerShown: true, title: 'Offers' }} />
      <Tabs.Screen name="requests" options={{ headerShown: true, title: 'Requests' }} />
      <Tabs.Screen name="orders" options={{ headerShown: true, title: 'Orders' }} />
      <Tabs.Screen name="shop" options={{ headerShown: true, title: 'My shop' }} />
    </Tabs>
  );
}
