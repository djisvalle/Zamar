/** How many screen pixels one of `el`'s own layout pixels spans. Live Stage
 * magnifies its chart with a CSS transform to fill a landscape screen (see
 * `LiveStage.tsx`), so inside it a pointer's client coordinates are this
 * many times the content coordinates that layout, marks and scores use.
 * 1 anywhere nothing is magnified. */
export function screenScaleOf(el: HTMLElement | null | undefined): number {
  if (!el || !el.offsetWidth) return 1;
  const scale = el.getBoundingClientRect().width / el.offsetWidth;
  return scale > 0 && Number.isFinite(scale) ? scale : 1;
}
