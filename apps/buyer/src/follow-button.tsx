import { useSetFollow } from '@fayda/api-client';
import { Button } from '@fayda/ui';
import { Pressable, Text } from 'react-native';

/**
 * Follow / Following for a shop. It flips at once (the hook updates every cached card and the shop page) and is put
 * back if the server refuses. Callers do not render it for the person's own shop.
 */
export function FollowButton({ sellerId, shopName, following, size = 'sm', onDark }: { sellerId: string; shopName: string; following: boolean; size?: 'sm' | 'md'; onDark?: boolean }) {
  const set = useSetFollow();
  if (onDark)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={following ? `Unfollow ${shopName}` : `Follow ${shopName}`}
        accessibilityState={{ disabled: set.isPending }}
        disabled={set.isPending}
        onPress={() => set.mutate({ sellerId, follow: !following })}
        style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, borderColor: following ? 'transparent' : 'rgba(255,255,255,0.8)', backgroundColor: following ? 'rgba(255,255,255,0.2)' : 'transparent', justifyContent: 'center' }}
      >
        <Text style={{ color: '#fff', fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12 }}>{following ? 'Following' : 'Follow'}</Text>
      </Pressable>
    );
  return (
    <Button
      title={following ? 'Following' : 'Follow'}
      accessibilityLabel={following ? `Unfollow ${shopName}` : `Follow ${shopName}`}
      variant={following ? 'outline' : 'primary'}
      size={size}
      disabled={set.isPending}
      onPress={() => set.mutate({ sellerId, follow: !following })}
    />
  );
}
