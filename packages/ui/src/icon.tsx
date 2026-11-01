import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';
import { iconShapes, type IconName, type IconShape } from './icon-shapes';
import { useTheme } from './theme';

export type { IconName } from './icon-shapes';
export const iconNames = Object.keys(iconShapes) as IconName[];

/** An outline icon from the prototype's set. `color` defaults to the theme's ink; `fill` is for solid hearts and stars. */
export function Icon({ name, size = 22, color, fill = 'none', strokeWidth = 2, style }: { name: IconName; size?: number; color?: string; fill?: string; strokeWidth?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const stroke = color ?? colors.ink;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {(iconShapes[name] as readonly IconShape[]).map(([tag, a], i) => {
        if (tag === 'path') return <Path key={i} d={a.d!} />;
        if (tag === 'circle') return <Circle key={i} cx={a.cx!} cy={a.cy!} r={a.r!} />;
        if (tag === 'polygon') return <Polygon key={i} points={a.points!} />;
        return <Rect key={i} x={a.x!} y={a.y!} width={a.width!} height={a.height!} {...(a.rx ? { rx: a.rx } : {})} />;
      })}
    </Svg>
  );
}
