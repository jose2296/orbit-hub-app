import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { FullTitleSheet } from "@/components/media/full-title";

/**
 * A long press on a name, **on a row that is already pressable**, and a sheet
 * with the whole of it.
 *
 * **There is deliberately no `Pressable` in here.** The obvious way to make a name
 * show itself in full is to wrap the name in something pressable with an
 * `onLongPress`, and that breaks the row it is sitting in: on a phone the
 * innermost view that asks for the touch becomes the responder, so the inner one
 * takes the gesture and the row's own `onPress` never runs. A list of notes where
 * tapping a note does nothing is a much worse bug than a long name, and it is a
 * bug the **web cannot show**, which is the only place any of this is checked:
 * there a `Pressable` is a `click` and it bubbles, so both fire and the row looks
 * like it still works.
 *
 * So the press is added to the row's **own** pressable, which is already there and
 * already the responder: put `onLongPress={nombre.onLongPress}` on it and nothing
 * else. A normal tap is not touched at all — the flag below is only ever set by a
 * long press, and a tap leaves it unset and goes straight through.
 *
 * **What has to be undone is the row opening behind the sheet.** A long press is
 * not a cancel: React Native still delivers the release as a press, so the row
 * would open a moment after the sheet came up, and on the web the `click` bubbles
 * for the same reason. The release is swallowed by a **capture** listener on the
 * document, which runs before any handler inside it, and only for the one click
 * that follows a long press.
 *
 * On iOS and Android there is no document and no `click`, so that listener does
 * not exist and there is nothing to swallow: the gesture is the platform's own
 * `onLongPress` and the release is the framework's business. That branch is the
 * whole reason this file is a hook and not a component.
 */
export function useLongPressName(initial = ""): {
  /** `onLongPress` for a row, with its own name. */
  onLongPress: (text: string) => void;
  /** Render this once, next to the rows. */
  sheet: ReactNode;
} {
  const [texto, setTexto] = useState(initial);
  const [abierto, setAbierto] = useState(false);
  const recienPulsado = useRef(false);
  const espira = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // `document` only exists on the web, and that is the whole point: on a phone
    // this is not a branch, it is a no-op.
    if (typeof document === "undefined") return;
    const alPulsar = (event: Event) => {
      if (!recienPulsado.current) return;
      recienPulsado.current = false;
      clearTimeout(espira.current);
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", alPulsar, true);
    return () => document.removeEventListener("click", alPulsar, true);
  }, []);

  const onLongPress = useCallback((name: string) => {
    recienPulsado.current = true;
    setTexto(name);
    setAbierto(true);

    /*
      And the highlight the browser has already drawn **goes away with it**.

      Pressing and holding with a mouse on the web is how you select text, so the
      moment the long press has been held long enough for React Native to call it
      one, the name under the finger is blue — and it stays blue after the sheet is
      closed, on a name nobody can then do anything with. On a phone there is no
      selection to get rid of and this line does nothing.

      It is a removal and not a `user-select: none` over the app on purpose: the
      notes editor is text worth selecting and copying, and a rule that stopped
      that to save one long press would cost more than it saves. The drag needed the
      opposite trade — there the selection is drawn *while* the finger is moving,
      which nobody can unsee — so that one is `user-select: none` on the row.
    */
    if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();

    /*
      And the flag **expires**, because the click it is waiting for is not
      guaranteed to happen.

      A long press releases into a `click` only when the press and the release
      land on the same element. Move a finger two points while holding, or let go
      over a different control, or press and hold with a mouse that reports a
      `pointercancel`, and there is no click — and the flag stays armed waiting
      for one. The next click anybody makes anywhere is then eaten: close a sheet
      with its cross and nothing happens, press the three dots of a row and the
      menu does not open, and it looks like the app has stopped listening rather
      than like one flag was left set.

      Four hundred milliseconds is longer than any release-after-hold and short
      enough that the next deliberate press is never swallowed. The flag is for
      swallowing **the click that ends this long press** and for nothing else.
    */
    clearTimeout(espira.current);
    espira.current = setTimeout(() => {
      recienPulsado.current = false;
    }, 400);
  }, []);

  return {
    onLongPress,
    sheet: abierto ? <FullTitleSheet text={texto} onClose={() => setAbierto(false)} /> : null,
  };
}

/**
 * The same thing for **one** row, and it is this one for a row that is drawn by a
 * component of its own — the note row, the row of a list. The name is fixed, so
 * the caller does not have to remember to pass the same string twice.
 */
export function useLongPressText(text: string): {
  onLongPress: () => void;
  sheet: ReactNode;
} {
  const { onLongPress, sheet } = useLongPressName(text);
  return { onLongPress: () => onLongPress(text), sheet };
}
