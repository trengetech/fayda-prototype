import { Button } from '@fayda/ui';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';

type State = 'idle' | 'copied' | 'failed';

/**
 * One tap puts `value` on the clipboard and the button says "Copied" for two seconds. No dialog, no share sheet.
 * If the phone refuses (rare), the button says so and the text stays selectable on screen.
 */
export function CopyButton({ value, title = 'Copy', size = 'sm', variant = 'outline' }: { value: string; title?: string; size?: 'sm' | 'md' | 'lg'; variant?: 'primary' | 'outline' | 'ghost' }) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    let next: State = 'copied';
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      next = 'failed';
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return <Button title={state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : title} size={size} variant={variant} onPress={() => void copy()} />;
}
