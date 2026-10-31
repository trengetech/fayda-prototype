import { useApiClient } from '@fayda/api-client';
import { useQuery } from '@tanstack/react-query';

/** The buyer's own profile: addresses and contact numbers. */
export function useBuyerProfile() {
  const client = useApiClient();
  return useQuery({ queryKey: ['buyer-profile', client.baseUrl], queryFn: () => client.getBuyerProfile() });
}
export const PROFILE_KEY = 'buyer-profile';
