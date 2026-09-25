/**
 * The masonry balancer.
 *
 * Cards are placed shortest column first, which is what keeps the bottom of
 * the layout level. Heights are estimates before anything is measured, so this
 * has to produce a sensible first frame with no real measurement at all.
 */
export function balanceIntoColumns(
  heights: number[],
  columns: number,
): number[][] {
  const count = Math.max(1, columns);
  const buckets: number[][] = Array.from({ length: count }, () => []);
  const totals = new Array<number>(count).fill(0);

  heights.forEach((height, index) => {
    let shortest = 0;
    for (let i = 1; i < count; i += 1) {
      if ((totals[i] ?? 0) < (totals[shortest] ?? 0)) shortest = i;
    }
    buckets[shortest]?.push(index);
    totals[shortest] = (totals[shortest] ?? 0) + height;
  });

  return buckets;
}

/**
 * How many columns fit a given width.
 *
 * One on a phone, and as many as fit on a tablet or a browser window, with a
 * ceiling so a very wide screen does not produce a wall of narrow cards.
 */
export function columnsForWidth(
  width: number,
  minColumnWidth: number,
  maxColumns: number,
): number {
  if (width <= 0) return 1;
  const fitted = Math.floor(width / Math.max(1, minColumnWidth));
  return Math.max(1, Math.min(fitted, Math.max(1, maxColumns)));
}
