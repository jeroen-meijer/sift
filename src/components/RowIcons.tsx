/**
 * Static row icons. Every table row shows a play and a star icon; as Phosphor
 * React components they cost a context read and a component render per row,
 * which adds up when a fast scroll swaps all ~57 mounted rows at once. These
 * are the same Phosphor paths (256 × 256 viewBox) as plain SVG.
 */

import { SPLICE_MARK_PATHS, SPLICE_MARK_VIEWBOX } from "../lib/spliceMark";

const STAR_FILL =
  "M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z";
const STAR_REGULAR =
  "M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z";
const PLAY_FILL =
  "M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z";

interface IconProps {
  size: number;
  className?: string;
}

export function RowPlayIcon({ size, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d={PLAY_FILL} />
    </svg>
  );
}

export function RowStarIcon({ size, className, filled }: IconProps & { filled: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d={filled ? STAR_FILL : STAR_REGULAR} />
    </svg>
  );
}

/**
 * Source-column Splice badge: black translucent chip, white mark.
 * Same colors in every theme so the mark stays recognizable.
 * Geometry: `src/lib/spliceMark.ts`.
 */
export function RowSpliceIcon({ size = 16, className }: { size?: number; className?: string }) {
  const inset = Math.max(2, Math.round(size * 0.12));
  const icon = Math.max(8, size - inset * 2);
  return (
    <span
      className={className ? `source-badge source-badge-splice ${className}` : "source-badge source-badge-splice"}
      title="Splice"
      role="img"
      aria-label="Splice"
      style={{ width: size, height: size }}
    >
      <svg width={icon} height={icon} viewBox={SPLICE_MARK_VIEWBOX} fill="#fff" aria-hidden>
        {SPLICE_MARK_PATHS.map((d) => (
          <path key={d.slice(0, 24)} d={d} />
        ))}
      </svg>
    </span>
  );
}
