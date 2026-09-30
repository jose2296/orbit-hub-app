/**
 * The geometry of a ring that fills up, in quarters.
 *
 * **And not in halves, because a `View` cannot draw an arc.** A square with a
 * border and round corners is a whole ring, and clipping it gives you a *piece* of
 * that ring: clip it to two sides and you have a quarter. Four quarters make the
 * circle, so a ring that fills is four clipped pieces and **one rotation per
 * piece** — and that is what makes the arithmetic testable instead of something
 * to squint at. A ring that is fifteen degrees out looks, in a screenshot, like a
 * design choice.
 *
 * The three ways this could have gone, and why this one:
 *
 * - **`react-native-svg`**, which is what the old app used. It is not a
 *   dependency here, and adding a native module for one ring means a native
 *   dependency nobody can try on a device.
 * - **Two halves**, which reads better and is wrong: two borders of a round
 *   square are a *quarter* of its ring, so two halves only ever reach 50%. The
 *   third piece is what real pie charts have, and the geometry is where that
 *   usually goes wrong.
 * - **Ten marks**, which is what this file replaced. It reads as ten marks, and
 *   nobody is told the score is a tenth of something.
 */
export interface Cuarto {
  /** Degrees, 0 to 90. Zero means this quarter is not drawn at all. */
  giro: number;
  /** False when there is nothing to show, so it can be left out of the tree. */
  visible: boolean;
}

/**
 * The four rotations for a `ratio` between 0 and 1.
 *
 * **Quarter by quarter, and each one starts only when the one before it is
 * full.** A quarter holds 90 degrees, so quarter `k` of four is filled from
 * `k/4` of the ratio. Rounding this per quarter is what would make a 0.62 ring
 * look like 0.5 or 0.75: it is 0.48 of the way through the third quarter, and the
 * other two fifths are exactly full.
 *
 * The circle starts at twelve o'clock and goes clockwise, so the first quarter is
 * the top right one — the one after "top" when you read the clock — and a ring at
 * zero is nothing at all.
 */
export function cuartosDeProgreso(ratio: number): Cuarto[] {
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const Advanced = r * 4;

  return [0, 1, 2, 3].map((k) => {
    const avance = Advanced - k;
    if (avance <= 0) return { giro: 0, visible: false };
    return { giro: Math.min(90, avance * 90), visible: true };
  });
}
