import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

import { AppText } from "@/components/ui/text";
import type { TextVariant } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface FullTitleProps {
  text: string;
  /** How many lines before it gives up, and the default is the usual two. */
  numberOfLines?: number;
  /**
   * The type scale to draw it at, so a caller that needs a strong name or a
   * caption does not have to give the variant up for the sake of the long press.
   */
  variant?: TextVariant;
  /**
   * `text` when the name is **already inside something pressable**.
   *
   * A row that opens the thing is a button labelled with its name, and a button
   * inside a button is two controls with the same name for a screen reader and
   * invalid markup on the web. The long press is a gesture on the text, not a
   * second control, so in that case it is announced as text with a hint and the
   * row keeps the only button on the screen.
   */
  role?: "button" | "text";
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * A title that is cut off, **and a way to read the whole of it**.
 *
 * The names in this app come from a provider and a provider has films called
 * "Everything Everywhere All at Once" and books with subtitles three lines long. A
 * card is a hundred and forty points wide and two lines tall, so the name is cut,
 * and a cut name is not a smaller piece of information: it is a *different* piece
 * of information, because "Everything Everywhere" and "Vengadores: La era de" are
 * not titles anybody can recognise a film by.
 *
 * **Long press, and not a second line and not a tooltip.** A tooltip needs a hover,
 * and a hover does not exist on a phone, so the thing that answers "what does it
 * say" would work on the web and nowhere else. A long press is the one gesture the
 * three targets share, and it is already the gesture this app uses for dragging a
 * row, so it is not a new thing to learn. It also cannot be fired by accident: a
 * tap still goes where the tap goes.
 *
 * **A sheet and not a floating label.** A floating label has to be positioned
 * against the text it belongs to, and the text is inside a horizontal scroller, a
 * vertically scrolling screen and sometimes a sheet of its own — three clipping
 * parents, and a tooltip clipped by the edge of a card is worse than no tooltip.
 * A sheet is in the same place every time, it fits a name of any length, and the
 * text in it can be selected and copied.
 */

/**
 * The sheet with the whole name in it, **on its own so that two things can open
 * it**.
 *
 * A name inside a pressable row cannot carry its own `Pressable` — see
 * `useLongPressText` — and a name that is not inside anything can. Sharing the
 * sheet is what keeps those two from being two different dialogs.
 */
export function FullTitleSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    /*
      **Scrollable**, and it was not. The whole reason this sheet exists is that the
      name was cut off, and at the size it is drawn now a long one needs more room
      than a phone has — so a fixed sheet that used to show three lines would show
      two and a half and cut the ending off, which is the exact bug it was built to
      fix. Scrolling is the admission that the name can be any length.
    */
    <Sheet visible onClose={onClose} title={t("fullTitle.title")} scrollable>
      <View
        style={[
          styles.caja,
          {
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            gap: theme.spacing.sm,
          },
        ]}
      >
        {/*
          **`display` and not `body`.** This is the one screen in the app whose
          entire content is a name, and it was drawing it at the size of a paragraph
          somewhere else in a card — which is a name you can read and then cannot
          remember having read. `display` is 32 over 38 and it is the top of the
          scale, which is what the scale is for.

          **Selectable**, because the reason somebody wants the whole name is very
          often that they are going to look it up somewhere else, and text that
          cannot be selected cannot be copied.
        */}
        <AppText variant="display" selectable style={{ color: theme.colors.text }}>
          {text}
        </AppText>
      </View>
    </Sheet>
  );
}

export function FullTitle({
  text,
  numberOfLines = 2,
  variant = "body",
  role = "button",
  style,
  testID,
}: FullTitleProps) {
  const t = useTranslation();
  const [abierto, setAbierto] = useState(false);

  /*
    The click that follows a long press **must not reach the row around it**.

    Almost every name in this app sits inside something pressable: a row of a
    list, a card, the body of a search result. On a phone a long press consumes the
    touch and nothing else fires, and on the web it does not: a `Pressable` is a
    `click`, the browser fires one whenever the press and the release land on the
    same element, and it bubbles. So pressing and holding a folder's name opened
    the sheet **and** navigated into the folder, and the sheet was a sheet on a
    screen that was already changing.

    React Native's own press handling already suppresses its `onPress` after a
    long press, so the only thing left to stop is the DOM event on its way up, and
    that is stopped here in the **capture** phase — before the row's own handler is
    reached, and not after it has already run.
  */
  const nodo = useRef<View>(null);
  const nombre = useRef<View>(null);
  const recienPulsado = useRef(false);
  /**
   * The flag expires, **because the click it waits for may never arrive**.
   *
   * Move the finger while holding, or let go over something else, and the press
   * ends without a `click` — and the flag stays armed waiting for one, and the
   * next click anybody makes anywhere is eaten with it. See `useLongPressName`.
   */
  const espira = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const elemento = nodo.current as unknown as HTMLElement | null;
    // `addEventListener` only exists on a DOM node, and that is the whole point:
    // on iOS and Android this is not a branch, it is a no-op.
    if (!elemento?.addEventListener) return;
    const alPulsar = (event: Event) => {
      if (!recienPulsado.current) return;
      recienPulsado.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    elemento.addEventListener("click", alPulsar, true);
    return () => elemento.removeEventListener("click", alPulsar, true);
  }, []);

  const abrir = useCallback(() => {
    /*
      The focus is given back, **on the web and only on the web**.

      A `Pressable` is a `<button>` and the browser focuses it when it is pressed,
      so the focus ring stays around the title after the sheet closes: a blue
      rectangle around one row of a list of films, which looks like a selection
      nobody made. On a phone there is no focus ring and this is not a branch, it
      is a no-op — the same shape as the click guard above.
    */
    (nombre.current as unknown as HTMLElement | null)?.blur?.();
    recienPulsado.current = true;
    setAbierto(true);
    clearTimeout(espira.current);
    espira.current = setTimeout(() => {
      recienPulsado.current = false;
    }, 400);
  }, []);

  return (
    <View ref={nodo}>
      <Pressable
        ref={nombre}
        onLongPress={abrir}
        delayLongPress={320}
        accessibilityRole={role}
        accessibilityLabel={role === "button" ? `${text}. ${t("fullTitle.hint")}` : undefined}
        accessibilityHint={t("fullTitle.hint")}
        testID={testID}
        style={styles.zona}
      >
        <AppText variant={variant} numberOfLines={numberOfLines} style={style}>
          {text}
        </AppText>
      </Pressable>

      {/*
        Rendered only while it is open, and not kept mounted: a `Modal` that is
        closed still costs a `Modal` in the tree of every card in a carousel, and
        there are thirty of those.

        It is `FullTitleSheet` and not a second copy of the body. They were the same
        seven lines written twice, which is how the size and the padding got fixed in
        one of them and not the other — and the one that matters most, the name
        pressed on a card, was the one left at body size.
      */}
      {abierto ? <FullTitleSheet text={text} onClose={() => setAbierto(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  zona: {
    alignSelf: "stretch",
  },
  caja: {
    // Full width, so the surface behind the name stops short of the sheet's own
    // edges instead of the text sitting in a gutter and the surface filling it.
    alignSelf: "stretch",
  },
});
