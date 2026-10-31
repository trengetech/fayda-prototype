import { AppText } from '@fayda/ui';
import { Pressable, View } from 'react-native';

/** ★★★☆☆ for display. */
export const starsText = (n: number): string => '★'.repeat(n) + '☆'.repeat(5 - n);

/** The seller's rating line: "★ 4.5 (12)", or "No reviews yet". Only said when the numbers are really known. */
export function ratingLine(rating: number | null | undefined, count: number | null | undefined): string | null {
  if (count == null) return null;
  return count > 0 && rating != null ? `★ ${rating.toFixed(1)} (${count})` : 'No reviews yet';
}

export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} accessibilityRole="radio" accessibilityState={{ selected: value === n }} accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`} onPress={() => onChange(n)} hitSlop={6}>
          <AppText size={28} tone={n <= value ? 'accent' : 'faint'}>{n <= value ? '★' : '☆'}</AppText>
        </Pressable>
      ))}
    </View>
  );
}
