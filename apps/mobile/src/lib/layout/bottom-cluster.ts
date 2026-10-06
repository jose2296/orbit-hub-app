/**
 * La esquina inferior derecha de una lista: el buscador, el botón de filtrar, el
 * `+` y la bandeja de lo hecho.
 *
 * El buscador se cuenta **encima** del de filtros y no aparte, porque los dos son
 * el mismo tipo de boton —36, el mismo— y la pila se lee de abajo arriba: `+`,
 * filtrar, buscar. Si el buscador viviera en otro sitio, uno de los dos acabaria
 * tocando el borde o solapado con el `+`, que es como se empezó.
 *
 * Los tres números estaban escritos a mano en la pantalla y ninguno comprobaba
 * nada del otro. El resultado medido era un hueco de **28 puntos** entre el `+` y
 * la bandeja, para un botón de **36**: no cabía, y no había forma de que algo lo
 * dijera. Poner el botón encima del `+` sin esto es volver a escribir la misma
 * suma en otro sitio y con la misma esperanza.
 *
 * Aquí la pila se cuenta una vez. Los tamaños vienen del tema y de los botones,
 * que es donde se inventaron: si `Button` cambia de alto, esta cuenta deja de
 * mentir sola.
 */
export interface BottomCluster {
  /** The `+`, from the bottom edge of the screen. */
  fabBottom: number;
  /** How tall the `+` is. `Button` at `lg`, which is what the list screen draws. */
  fabSize: number;
  /** The filter button, from the bottom edge, sitting above the `+`. */
  controlsBottom: number;
  /** The search button, above the filter one and under the `+`. */
  searchBottom: number;
  /** How tall the search button is. Same as the filter one: both are 36. */
  searchHeight: number;
  /** How tall the filter button is. `Button` at `sm`. */
  controlsHeight: number;
  /** The tray of finished items, from the bottom edge, under both. */
  trayBottom: number;
  /** The space left between one and the next. */
  gap: number;
  /** The margin from the screen edge to the nearest thing. */
  margin: number;
}

export function bottomCluster(
  theme: { spacing: { lg: number; sm: number } },
  sizes: { fab?: number; controls?: number } = {},
): BottomCluster {
  const fabSize = sizes.fab ?? 56;
  const controlsHeight = sizes.controls ?? 36;
  const margin = theme.spacing.lg;
  const gap = theme.spacing.sm;

  return {
    fabBottom: margin,
    fabSize,
    controlsBottom: margin + fabSize + gap,
    controlsHeight,
    searchBottom: margin + fabSize + gap + controlsHeight + gap,
    searchHeight: controlsHeight,
    trayBottom: margin + fabSize + gap + controlsHeight + gap + controlsHeight + gap,
    gap,
    margin,
  };
}
