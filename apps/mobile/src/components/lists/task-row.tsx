import { Pressable, StyleSheet, View } from "react-native";

import type { ListItem, Priority, TagColors } from "@orbit-hub/contracts";

import { Badge } from "@/components/ui/badge";
import type { IconName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useA11yHint } from "@/components/ui/a11y-hint";
import { ItemIcon } from "@/components/lists/icon-picker";
import { TagChip } from "@/components/lists/tag-chip";
import { AppText } from "@/components/ui/text";
import { useLongPressText } from "@/hooks/use-long-press-text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

const PRIORITY_TONE = {
  none: "neutral",
  low: "info",
  medium: "warning",
  high: "danger",
} as const;

/**
 * The glyph each urgency carries in a row, next to the colour.
 *
 * Three shapes that escalate rather than three that are merely different: a ring,
 * a ring with a bang, and a triangle. At ten points the colour is doing half the
 * work — a badge on its own line under a title is small, and two reds at ten
 * points are one red — so the shape is what still says *how* urgent when the
 * colours are not being compared side by side.
 *
 * No `none`: a task with no urgency draws no badge at all, so there is nothing to
 * put a glyph on.
 */
const PRIORITY_ICON: Record<Exclude<Priority, "none">, IconName> = {
  low: "remove-circle-outline",
  medium: "alert-circle-outline",
  high: "warning",
};

/**
 * One task row, shared by the pending and the completed sections.
 *
 * And by the board, which is the reason it is a component and not a local
 * function: a board row is this same row, because a task of a board is the same
 * task — the same icon, the same title, the same urgency, the same labels. Only
 * two things differ, and both are props rather than a second component:
 *
 * - **`onToggle` is optional.** A board task is not ticked, it is *in a state*, so
 *   there is nothing to tick it with. Without this prop no checkbox is drawn at
 *   all, and the row takes the space the box would have taken rather than
 *   leaving a gap where it used to be.
 * - **`edgeColor` is optional, and paints nothing when absent.** The flat list has
 *   no state to colour, and does not pass one, so the row it draws is the row it
 *   drew before this prop existed.
 */
export function TaskRow({
  item,
  tagColors,
  onToggle,
  onEdit,
  onIcon,
  edgeColor,
}: {
  item: ListItem;
  /**
   * The colours of **this** list, handed down from the screen's `list`.
   *
   * A prop and not a lookup: "Mercadona" is a word any list can use, and two
   * lists in the same app can hold it in two colours. A row that went and found
   * the colour itself — from a module map, from the item, from a hook — would
   * paint both of them the same one, and the only way to know which list a row
   * belongs to is to be told.
   */
  tagColors: TagColors;
  /**
   * What ticking this task does, and **the reason the checkbox is optional**.
   *
   * There is no sensible default here: with no `onToggle` the box is not drawn
   * greyed out or disabled, it is not drawn, because a disabled box in the margin
   * of every row of a board is furniture saying nothing.
   */
  onToggle?: () => void;
  onEdit: () => void;
  onIcon: () => void;
  /**
   * The colour of the state down the left edge, **on a board**.
   *
   * A column of a board is already headed by the name of its state, so the colour
   * is not there to label the column — it is there so a row keeps saying which
   * state it is in when it is read away from its column: in a search, in a card
   * that shows a task from elsewhere, or scrolled under a sticky header.
   *
   * Not a theme token: it is the colour of the **state**, which is chosen per
   * list and is not part of the palette the app resolves by name. It is handed in,
   * not looked up, for the same reason `tagColors` is.
   */
  edgeColor?: string;
}) {
  const theme = useTheme();
  const t = useTranslation();

  /**
   * The whole of a name the user wrote, **on this row's own press**.
   *
   * A `Pressable` around the name would take the gesture away from the row on a
   * phone and the row would stop opening the item — a bug the web cannot show,
   * because a click bubbles there and both fire. See `useLongPressText`.
   */
  const nombreLargo = useLongPressText(item.title);

  const pistaNombre = useA11yHint(t("itemEdit.subtitle"));

  return (
    <View
      testID={`item-row-${item.id}`}
      style={[
        styles.item,
        {
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
// Sin `paddingRight` para el asa de arrastrar: **el asa ya no esta.**
          // Reserve 28 pt a la derecha durante semanas para algo que no se dibuja,
          // y con el icono en la linea del titulo ese hueco era ademas lo que
          // empujaba el nombre hacia el borde. Lo que cede ahora cuando el nombre
          // es largo es el `flexShrink: 1` de `styles.nombre`.
          // The edge is a `borderLeft` on **this** box — the same one that carries
          // the `padding.lg` at the top of this object, not a wrapper around it. So
          // the border is drawn outside that padding, and what sits between the
          // colour and the icon is the padding: 16 points, plus the 3 of the
          // border. That is the point of doing it here rather than on a wrapper:
          // flush against the left of the row, so a task keeps its colour on the
          // edge instead of floating a padding away from it.
          //
          // **And it costs the row three points of content width.** The checkbox,
          // the icon and the title all live inside the content box, and a border
          // comes out of it, so a board row is three points narrower than a list
          // row on the same device. The `styles.nombre` numbers were measured on a
          // row **without** this border — and that row was already measuring 755 of
          // its own 754 points — so nobody has measured what three more do to a
          // title that is already capped at `numberOfLines={2}`. It is written down
          // here rather than reasoned about here, and it is Task 8's to measure
          // with the board in front of it.
          //
          // Painted **only when there is a colour**, and that is the whole reason
          // it is a conditional spread and not `edgeColor ?? someBorder`: the flat
          // list passes none and must draw what it drew before this prop existed,
          // and on web a `borderLeftWidth: 0` still is not the same thing as no
          // border at all.
          ...(edgeColor
            ? { borderLeftWidth: 3, borderLeftColor: edgeColor }
            : null),
        },
      ]}
    >
      {/*
        The checkbox, **and only when something can tick it.**

        A board row has no `onToggle`, because a task there is in a state rather
        than done, and a box in the margin of every row would be a control that
        says nothing. `null` rather than a disabled box for the same reason: a
        greyed-out tick is furniture, and the row is already saying what it is.

        The `label=""` is untouched and must stay: it is the thing that keeps an
        empty `Text` with `flex: 1` out of the checkbox, which measured 755 points
        of a row's 754 and ate the title. See `styles.nombre` and `checkbox.tsx`. */}
      {onToggle ? (
        <Checkbox checked={item.completed} onToggle={onToggle} label="" />
      ) : null}

      {/*
        The column, and it has two children that take part in layout: the line of
        the title and the line of the labels. The `gap: 2` is the distance under the
        title and it is the same number it has always been — the other two children,
        `nombreLargo.sheet` and `pistaNombre.node`, were never counted by it and
        still are not: the sheet is a `Modal`, which on web is a portal out of this
        box entirely, and the hint is `position: absolute`, and a child in either
        of those is not a flex item for `gap` to put anything between. */}
      <View style={[styles.flex, { gap: 2 }]}>
        {/*
          The icon and the name, **on one line**, and that line is the whole fix.

          The icon used to be a **sibling of this column**, and `styles.item` has
          `alignItems: "center"`, so it centred against *the title plus whatever is
          under it*: on a task with a badge or labels the icon sat below the title
          and on a task with neither it sat centred, and two rows that look alike
          had their icon at two heights with no reason for it. Inside the line of
          the title it is centred on **that** line, and the badge and the labels go
          to a line of their own, so nothing under the title can move it again.

          The icon is still to the right of the checkbox and not on the far edge
          of the row: out there it read as a picture of the list instead of the
          icon of **this** row, and with the checkbox beside it you can tell at a
          glance what you are going to tick and what you have ticked.

          And with no icon **nothing is drawn**: no glyph and no reserved space. The
          `+` that used to sit here when there was no icon is gone — it said "add an
          icon" on almost every task of every list, and it said it in the place
          where the name should be. What replaced it is nothing, and an empty gap
          is not nothing either: the name would start glued to the checkbox and the
          row would fill with air, which is a larger empty space. So the titles of
          the rows with an icon start a few points further right than the ones
          without, which has been asked for twice.

          And that is why this is not even an empty `View`: an invisible target the
          width of a finger next to every name without an icon would open the icon
          picker on a tap that looked like it was on the name.

          The `gap` is the row's own `spacing.md` and it is not a new number: the
          icon has not moved, it has moved its parent.

          Y el `testID` es para poder distinguir esta línea de la columna en una
          medición, que es lo único para lo que está: `nombre.parentElement` vale
          para las dos —en el árbol de antes esta línea **era** la columna— y medir
          contra lo que resulta por casualidad mide lo que se quiera. */}
        <View
          testID={`item-title-line-${item.id}`}
          style={[styles.titulo, { gap: theme.spacing.md }]}
        >
          {/* The icon is its own target: it is a picture of what to buy, and
              pressing it opens the pictures rather than the row. */}
          {item.icon ? (
            <Pressable
              testID={`item-icon-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={t("icons.ofItem", { name: item.title })}
              hitSlop={8}
              onPress={onIcon}
              style={styles.iconSlot}
            >
              <ItemIcon
                icon={item.icon}
                style={item.iconStyle}
                color={item.iconColor}
              />
            </Pressable>
          ) : null}

          {/* The name opens the row. It used to be wired to the delete: one tap
              and the thing you were reading was gone, with nothing said and
              nothing to undo.

              It is the press and not the row behind it, so this one box carries both
              gestures: a tap opens the item, a long one opens the whole name. */}
          <Pressable
            onPress={onEdit}
            onLongPress={nombreLargo.onLongPress}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            {...pistaNombre.props}
            style={styles.nombre}
          >
            <AppText
              variant="body"
              tone={item.completed ? "subtle" : "default"}
              style={item.completed ? styles.strike : undefined}
              numberOfLines={2}
            >
              {item.title}
            </AppText>
          </Pressable>
        </View>
        {nombreLargo.sheet}
        {pistaNombre.node}

        {/* The urgency and the labels, **on the same line**, and **that is the
            second line of the column** — drawn only when there is a badge or at
            least one label, so a task with neither is a single line. It is a line
            of its own, and not part of the line of the title, because the icon
            shares the line of the title and nothing that is under it may move it:
            while the two were one column centred together, the icon went down with
            the labels.

            The urgency used to be on the right edge of the row, in the same column
            as the drag handle, where it read as part of the row's trailing
            furniture — and a column that lines the priorities of several rows up
            into is a column that means nothing. It is a property of the task, so
            it goes with the task.

            One line and not one each: a row with a priority *and* two labels was
            three lines tall, and the middle one held a single word in a pill. A
            task list is read by scanning down the names, and three lines per row is
            a list where only six names fit on a phone. The badge goes first — it
            is the coarser of the two, and the labels are what you are looking for
            when you are looking for a shop.

            The badge is not pressable here. The name above opens the sheet, and the
            sheet has the urgency as four things you can see, so a second way in
            from the row is two ways to end up disagreeing about the value.

            And it is compact, with a glyph: at this size the colour alone is not
            enough to sort a list by. */}
        {item.priority !== "none" || item.tags.length > 0 ? (
          <View style={[styles.meta, { gap: theme.spacing.xs }]}>
            {item.priority !== "none" ? (
              <Badge
                label={t(`items.priority.${item.priority}` as never)}
                tone={PRIORITY_TONE[item.priority]}
                icon={PRIORITY_ICON[item.priority]}
                size="compact"
              />
            ) : null}

            {/* The labels, one pill each, and only the ones there are. A row used
                to say "+ Label" under every name, which is a second place to add
                the same thing the item panel already does, in a row with no room
                to say it in.

                It used to be one string — "Mercadona · Panadería", joined, in the
                accent colour — and a string has nowhere to put a colour that
                belongs to one of its words. A label is a per-list thing with a
                per-list colour, so it has to be a box: the pill is the same one
                the task sheet draws, in the same colour, for the same reason.

                **A pill that reads in `theme.colors.text` is not a bug.** The pill
                keeps the label's own colour only where that colour reaches 4.5:1
                on the pill's fill — nine of the twelve palette colours fail that
                in each theme — and hands back the theme's text colour where it
                does not. The arithmetic lives in `@/lib/lists/tag-colors` and it
                is measured, so there is nothing to route around here.

                And they wrap rather than being cut: a pill cut in half is worse
                than a label cut in half, because the colour is on the pill and a
                half-pill reads as a different colour. `docs/roadmap.md` says it
                about a label beside a name and it is more true of a pill.

                `styles.metaTag` is the only thing about a pill this row decides
                for itself, and its comment says what it is for. */}
            {item.tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                colors={tagColors}
                size="compact"
                style={styles.metaTag}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * La linea del icono y del nombre, y **`alignItems: "center"` aqui es el arreglo**.
   *
   * El icono es hijo de esta linea, no hermano de la columna: asi se centra contra
   * la linea del titulo y no contra el titulo mas lo que haya debajo. Antes lo
   * centraba el `alignItems: "center"` de `styles.item` contra las dos lineas
   * juntas, y por eso una fila con insignia lo tenia mas abajo que otra que no la
   * tenia.
   *
   * Y el `flexShrink` va en el nombre y no aqui, y porque **esta linea es ahora una
   * fila y antes no lo era**: `react-native-web@0.21.2` pone `flexShrink: 0` en
   * todas sus `View` (`node_modules/react-native-web/dist/exports/View/index.js`,
   * `view$raw`), y en una columna la caja del nombre se estiraba al ancho de la
   * columna mientras que en una fila con `flexShrink: 0` se queda con su ancho de
   * contenido y empuja el resto hacia la derecha. El `minWidth: 0` de `styles.flex`
   * sigue haciendo lo que hacia —que la columna pueda encogerse— y el
   * `numberOfLines={2}` del nombre sigue poniendo el tope de dos lineas. El
   * comentario de `styles.nombre` lo cuenta entero, porque es su historia.
   */
  titulo: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * La segunda linea de la columna: la insignia de urgencia y las etiquetas, bajo
   * el nombre.
   *
   * Y no lleva `flexGrow`, y la razon es mas corta de lo que parece: **una caja
   * hermana no puede comerse el `gap` de su columna.** El `gap` va entre hijos, y
   * los dos hijos de aqui —esta linea y la del nombre— tienen su alto por su cuenta,
   * de modo que un nombre de dos lineas no se come nada: la separacion se queda en
   * los 2 pt de `styles.flex` y las pastillas van dos puntos mas abajo.
   *
   * Lo que si haria un `flexGrow` es repartir el alto sobrante entre las dos lineas
   * en vez de dejar el hueco al final de la columna, y repartir en una columna con
   * hueco al final es exactamente la disposicion que se pidio quitar. Asi que
   * la decision es "no", y no hace falta mas historia que esa.
   */
  meta: {
    flexDirection: "row",
    /*
     * Kept, and **none of the credit for it is the pill's.**
     *
     * `TagChip` and `Badge` both carry `alignSelf: "flex-start"`, and a child's
     * `align-self` wins over the row's `alignItems` — the rule
     * `workspace-color-picker.tsx` verified in a browser, on its `columnaPreview`,
     * where changing the row changed nothing. Those two are the only children this
     * style has, so today `alignItems` here governs **nothing**: neither the pill
     * nor the badge is centred by it, and neither is stopped from stretching by it
     * either. Each of them says that about itself.
     *
     * So it stays for the next child that arrives without an `alignSelf` of its
     * own, which is centred instead of stretched down the whole line; and because
     * it is the same `alignItems: "center"` as `styles.row` in the task sheet, so
     * the two lines of pills in this feature are built the same way.
     */
    alignItems: "center",
    /*
     * So the pills go under each other instead of being made narrower. They wrap,
     * they are never cut: with `flexWrap` the row measures every pill at its own
     * width and moves the ones that do not fit onto the next line, which is the
     * only arrangement in which a pill is still the colour it was chosen to be.
     */
    flexWrap: "wrap",
  },
  /**
   * And one label can still be wider than the whole line.
   *
   * The `flexWrap` above is already what saves the badge: a row with twenty labels
   * puts them on further lines rather than pushing the badge off the right edge.
   * So this is not what keeps the badge whole, and it should not be described as
   * such. It is the one label with no other line to go to — there is nowhere for
   * it to wrap to — and without a `flexShrink` it would hang off the edge and be
   * cut in half. With it the pill narrows to the row and the label wraps *inside*
   * the pill, which is the whole pill and its whole colour.
   *
   * On the pill and not on a box around it: a wrapper that shrinks while the pill
   * inside it does not is an overflow waiting to happen. `TagChip` takes a `style`
   * for exactly this, and the badge is left alone — it is the one thing on that
   * line that must not be squeezed, because it is what the row is sorted by.
   */
  metaTag: {
    flexShrink: 1,
  },
  iconSlot: {
    width: 24,
    alignItems: "center",
  },
  /**
* The pressable that wraps the title. It is **not** a flex child that divides
   * the row, and the reason is not the one this comment used to give.
   *
   * Symptom this was written for: on Android the row showed its checkbox, its
   * icon and the badge — every one of them styled — and **no title at all**, and
   * an empty `{}` here was the fix that was believed to have done it. It did not
   * fix it: `{}` is not a style, it changes nothing, and the title kept vanishing.
   *
   * **The cause was next door, not here.** The `Checkbox` to the left is given
   * `label=""`, and it drew that empty label as an `AppText` with `flex: 1`. In
   * Yoga the grow resolves against the space available to the whole checkbox,
   * which is the rest of this row, so the checkbox grew to the row's full width —
   * measured at 755 of the row's 754 points — and `styles.flex`, the title column
   * sharing that row, got zero. Nothing to paint, and the badge crushed beside it.
   * An empty element measures zero in a browser however it is styled, which is why
   * the web was right and the phone was not.
   *
* So the fix is in `checkbox.tsx`, which no longer draws a label it was not
   * given, and nothing here had to change for it to work. What is left here is
   * a note not to "tidy" this into a `flex: 1`: the title is as long as it is,
   * and a box told how to divide a space is a box that decides the title's width
   * for it.
   *
   * **`flexShrink` below is a different bug and arrived separately.** The
   * checkbox was starving the *column*; this is the name overflowing its own
   * line, and it only became possible when the icon moved into that line. Before
   * that the name was a child of a **column**, where the cross axis stretched it
   * to the column's width and its own width never came into it. It is now a child
   * of a **row** — the line of the title, beside the icon — and in a row the
   * width is exactly what the box decides. `react-native-web@0.21.2` writes
   * `flexShrink: 0` on every `View` it makes (`view$raw`, in
   * `node_modules/react-native-web/dist/exports/View/index.js`), so without it the
   * name kept its full text width, ignored the `numberOfLines={2}` above it and
   * pushed the right edge of the row past the edge of the screen.
   *
   * So the number below is **not** a `flex: 1` — which is the thing that made
   * Android's flexbox give this box a width of zero, and which the checkbox was
   * the real cause of anyway — but a **shrink**, the other half of the same
   * property. `minWidth: 0` on `styles.flex` still does its own job: it is the
   * *column* that has to be able to give up room.
   */
  nombre: {
    flexShrink: 1,
  },
  /**
   * A copy of a `flex` the screen also has, and **on purpose**: that one holds the
   * kind line of a header, and a `StyleSheet` is not worth a coupling between a
   * route and a component. Two properties, and both of them load-bearing.
   */
  flex: {
    flex: 1,
    // A child of a `flex` does not go below its content by default, so the
    // title column would have stayed as wide as the longest word in it and
    // pushed the two actions off the right edge instead of making room.
    minWidth: 0,
  },
  strike: {
    textDecorationLine: "line-through",
  },
});
