import { useApiClient } from '@fayda/api-client';
import { useCallback, useEffect, useRef } from 'react';

type Ranker = 'NEWEST' | 'SCORED' | 'RELEVANCE' | 'PRICE';
type Scope = 'FOR_YOU' | 'FOLLOWING' | 'SEARCH' | 'SHOP';

const FLUSH_AT = 20;
const FLUSH_AFTER_MS = 5000;

/**
 * Tells the server which listings the feed showed (I-39, for ranking later). Each listing is reported once per screen visit,
 * in batches, and a failure is ignored: this must never slow or break scrolling. Nothing is sent until the server has said
 * which order the page came in (an older server does not, and then nothing is sent).
 */
export function useImpressionReporter(scope: Scope, ranker: Ranker | undefined): (listingId: string, position: number) => void {
  const client = useApiClient();
  const queue = useRef<{ listingId: string; position: number }[]>([]);
  const seen = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({ scope, ranker });
  current.current = { scope, ranker };

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const items = queue.current.splice(0, 50);
    const { scope: s, ranker: r } = current.current;
    if (!items.length || !r) return;
    client.reportImpressions({ scope: s, ranker: r, items }).catch(() => undefined);
  }, [client]);

  // Leaving the screen, or the page order changing, sends what is waiting, and the next visit starts a fresh set.
  useEffect(() => {
    const set = seen.current;
    return () => {
      flush();
      set.clear();
    };
  }, [scope, ranker, flush]);

  return useCallback(
    (listingId: string, position: number) => {
      if (!current.current.ranker || seen.current.has(listingId)) return;
      seen.current.add(listingId);
      queue.current.push({ listingId, position });
      if (queue.current.length >= FLUSH_AT) flush();
      else if (!timer.current) timer.current = setTimeout(flush, FLUSH_AFTER_MS);
    },
    [flush],
  );
}
