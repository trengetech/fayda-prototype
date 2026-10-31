import { useSetFollow } from '@fayda/api-client';
import { Button } from '@fayda/ui';

/**
 * Follow / Following for a shop. It flips at once (the hook updates every cached card and the shop page) and is put
 * back if the server refuses. Callers do not render it for the person's own shop.
 */
export function FollowButton({ sellerId, shopName, following, size = 'sm' }: { sellerId: string; shopName: string; following: boolean; size?: 'sm' | 'md' }) {
  const set = useSetFollow();
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
