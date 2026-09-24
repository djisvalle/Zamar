import { useLayoutEffect, useRef, useState } from "react";

/** One SMuFL glyph from the bundled Bravura font (see theme.css), cropped to
 * its own ink bounds. SMuFL glyphs sit on a staff-relative baseline — a
 * staccato dot sits far lower in its em box than a fermata — so centering the
 * em box would put each stamp at a different height relative to where it was
 * tapped. Measuring the rendered glyph instead centers every symbol exactly
 * on its position. */
export function SmuflGlyph({ glyph, size, color }: { glyph: string; size: number; color?: string }) {
  const textRef = useRef<SVGTextElement | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const measure = () => {
      const el = textRef.current;
      if (!el || cancelled) return;
      const b = el.getBBox();
      if (b.width > 0 && b.height > 0) setBox({ x: b.x, y: b.y, w: b.width, h: b.height });
    };
    measure();
    // Re-measure once Bravura has actually loaded — before that, the
    // browser measures a fallback font's box.
    document.fonts?.load("100px Bravura", glyph).then(measure, () => {});
    return () => {
      cancelled = true;
    };
  }, [glyph]);

  // Measured once at a fixed 100px and scaled via viewBox, so resizing a
  // stamp never needs a re-measure. `size` is the font size, so different
  // symbols keep their true relative proportions (a dot stays small).
  const pad = 4;
  const vb = box ? `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}` : "0 -100 100 100";
  const w = box ? ((box.w + pad * 2) / 100) * size : size;
  const h = box ? ((box.h + pad * 2) / 100) * size : size;
  return (
    <svg width={w} height={h} viewBox={vb} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <text ref={textRef} x={0} y={0} fontFamily="Bravura" fontSize={100} fill={color ?? "currentColor"}>
        {glyph}
      </text>
    </svg>
  );
}
