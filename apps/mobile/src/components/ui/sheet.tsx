import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";

import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useTranslation } from "@/lib/i18n";
import { captureTouch, originFromLastTouch } from "@/lib/touch-origin";
import { useTheme } from "@/theme";

import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";
import { SheetSucioContexto } from "./sheet-sucio";
import { SheetStep } from "./sheet-step";
import { AppText } from "./text";

/** A rectangle in the coordinates of the Sheet's own window, as `measureInWindow` gives it. */
export interface SheetOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetProps {
  visible: boolean;
  /**
   * The control that opened the sheet. When it is given the panel **grows out of
   * it** (and goes back into it) instead of rising from the bottom edge, and it
   * does so on a spring. Without it the sheet behaves as it always did.
   */
  origin?: SheetOrigin | null;
  /**
   * The page the sheet is showing, for a sheet that has several. When it changes
   * the new page settles in (fade + a slight scale) while the panel springs to the
   * new height, in the language of the morph that opened it. Leave it out for a
   * sheet that is always one page.
   */
  step?: string;
  onClose: () => void;
  title?: string;
  /** Short line under the title, for context. */
  subtitle?: string;
  /**
   * A picture beside the title.
   *
   * For the sheet of a film, where the title alone does not say which one: two
   * sheets with "Salsa de la abuela" open at once and there is no way to tell them
   * apart. It is the **cover**, and it sits on the left of the text because that
   * is where a face goes.
   *
   * Drawn by the caller and not fetched here, so the sheet has no idea what a
   * poster is: it gets a node of the right size and leaves it alone.
   */
  artwork?: ReactNode;
  children: ReactNode;
  /**
   * Go back one step, **and not close**.
   *
   * Seven sheets here hold more than one page, and each one had its own button at
   * the *bottom* of the form labelled either "Back" or "Cancelar" — two labels for
   * the same shape of button, one of which was lying, because it went up a step
   * rather than out of the sheet. And the export page had no way back at all: the
   * ✕ was the only exit and it closed everything.
   *
   * On the left of the header, which is where a back arrow goes and where the hand
   * already is. Left out entirely when absent, so the eighteen sheets that are one
   * step deep do not grow a control that does nothing.
   */
  onBack?: () => void;
  /** What the back control is called, for a screen reader. */
  backLabel?: string;
  /** Renders the content in a scroll view, for a long list of options. */
  scrollable?: boolean;
  /** Caps the height on a tall screen so a long list does not run off it. */
  maxHeightRatio?: number;

  /**
   * Commits the draft, and **its presence is what puts a Guardar in the sheet**.
   *
   * A sheet with nothing to commit does not get a disabled button that does
   * nothing: it gets no button, because there is nothing to commit. A Guardar
   * greyed out on a menu with six options to read teaches people that Guardar is
   * decoration.
   *
   * So this is the switch, and it is one switch: no second `showSave` that can
   * disagree with it, and no `saving` the caller has to remember to flip.
   */
  onSave?: () => void | Promise<void>;
  /** The confirming button, for a screen reader. */
  saveLabel?: string;
  /**
   * Why the confirming button cannot be pressed, or `undefined` when it can.
   *
   * A `string` and not a `boolean`, and that is the whole reason it exists: a grey
   * button with nothing written on it is a button somebody presses twice to find
   * out. Saying **why** —"Ponle un nombre"— turns a dead control into an
   * instruction.
   *
   * `undefined` means enabled, so a sheet with nothing to say about it passes
   * nothing and gets a live button.
   */
  saveDisabledReason?: string;
}

/**
 * A panel of options that rises from the bottom on a phone and sits in the
 * middle of the screen on a wide one.
 *
 * Options are the recurring shape of this app: creating a thing, the menu of a
 * list, the filters of a view, the sort order. On a phone they belong in a
 * panel that slides up from the bottom edge, where the thumb already is, and on
 * a wide screen a panel glued to the bottom of a 1200px column is a strip
 * nobody reads, so it becomes a dialog in the middle. One component with two
 * shapes, because the difference is a style and not a different screen.
 */
export function Sheet({
  visible,
  origin: originProp,
  step,
  onClose,
  title,
  subtitle,
  artwork,
  children,
  onBack,
  backLabel,
  scrollable = true,
  maxHeightRatio = 0.85,
  onSave,
  saveLabel,
  saveDisabledReason,
}: SheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const wide = isWide();
  const teclado = useKeyboardHeight();
  const { height: altoVentana, width: anchoVentana } = useWindowDimensions();

  /*
    Where the panel grows from, **decided once, when the sheet opens**: the control
    that was handed in or, failing that, the point where the finger last came down.
    It is read while rendering and kept in a ref because the entrance starts in the
    same commit that makes the sheet visible, and a state set from an effect would
    arrive a frame after the panel had already started rising from the edge.
  */
  const abierta = useRef(false);
  const origenElegido = useRef<SheetOrigin | null>(null);
  if (visible && !abierta.current) origenElegido.current = originProp ?? originFromLastTouch();
  abierta.current = visible;
  const origin = origenElegido.current;
  const contenido = step === undefined ? children : <SheetStep step={step}>{children}</SheetStep>;



  /**
   * Whether there is anything uncommitted, and who says so.
   *
   * The flag lives here and not in the screen that drew the panel, and that is
   * the fix for the family of bugs where opening one sheet leaves the next one
   * holding the first one's draft. It also **resets on open**, so there is no
   * path by which a sheet arrives dirty.
   */
  const [sucio, setSucio] = useState(false);
  /** The "¿sales sin guardar?" question, and nothing else. */
  const [preguntando, setPreguntando] = useState(false);
  /** Saving, so the button cannot be pressed twice and the words can change. */
  const [guardando, setGuardando] = useState(false);

  /*
    Clean on open, and **before** anything else.

    Resetting in an effect that runs after paint would leave one frame where the
    sheet is already visible and still dirty, and the guard would be armed for a
    panel nobody has typed in yet. So the same effect that mounts the panel
    disarms the question.
  */
  useEffect(() => {
    if (!visible) return;
    setSucio(false);
    setPreguntando(false);
    setGuardando(false);
  }, [visible]);

  /*
    The one way out, and **every exit goes through it**.

    A sheet leaves five ways: the dimmed background, the ✕, a drag downwards, the
    hardware back button on Android, and the screen itself setting something to
    null. Guarding "the close button" guards one of the five, and the other four
    keep throwing the work away — which is how a guard that is there still loses
    the edits. So they all arrive at `pedirCierre`, and `onClose` is only ever
    called from inside it.

    The drag is the subtle one: it has already committed to closing, animated the
    panel away and needs to leave immediately, and a question cannot be asked
    after the panel is gone. So the drag asks *before* it commits — see the
    gesture, which calls `puedeCerrar` first and only starts the exit if the
    answer was yes.
  */
  const puedeCerrar = useCallback((): boolean => {
    if (!sucio) return true;
    setPreguntando(true);
    return false;
  }, [sucio]);

  /** The committing button, and the only thing that clears "dirty". */
  const guardar = useCallback(async () => {
    if (!onSave || saveDisabledReason !== undefined) return;
    setGuardando(true);
    try {
      await onSave();
      /*
        And only once the promise is settled. Clearing before would mean a save
        that fails leaves the sheet looking clean with the text gone from the
        screen and never having reached the server — the worst of both, because
        the one signal that says "this is not saved" is the signal that said it
        was dirty.
      */
      setSucio(false);
    } finally {
      setGuardando(false);
    }
  }, [onSave, saveDisabledReason]);

  /** The exit itself, and the only caller of the screen's `onClose`. */
  const salir = useCallback(() => {
    setPreguntando(false);
    onClose();
  }, [onClose]);

  /** For the three exits that are a plain press: ask, and if allowed, go. */
  const pedirCierre = useCallback(() => {
    if (puedeCerrar()) salir();
  }, [puedeCerrar, salir]);

  /**
   * The same question, **for the gesture**, which runs on the UI thread.
   *
   * `runOnJS` sends it to the JS thread and brings the answer back, so this is the
   * same `sucio` and the same dialog as the ✕. A second name and not a second
   * rule, on purpose: a drag that discarded the work while the ✕ asked is exactly
   * the bug this exists to prevent.
   *
   * The cast through `unknown` is because `runOnJS` is declared as returning
   * `void` whatever it is handed, and it does not: it returns whatever the
   * function returned. Asserted once, in the one place that needs the value back,
   * instead of `as any` sprinkled over the gesture.
   */
  const preguntarCierre = useCallback((): boolean => puedeCerrar(), [puedeCerrar]);

  /*
    The content, **arriving a beat after the panel**.

    The `Modal` already slides the panel in, and on a wide screen it fades it. What
    it does not do is anything to the things inside: the panel is there and the
    options are on it in the same frame, so a sheet of twenty rows appears as a
    block that was always there. The panel moving and the content settling a
    fraction later is what makes the second one read as "it opened" instead of as
    "it was uncovered" — and sheets are how most of the app's choices get made, so
    it is the animation that runs most often in the product.

    **Ten points and 180 ms.** Any more and the options feel like they are lagging
    the panel; any less and there is nothing to see. It only runs when the sheet is
    visible, because a sheet that is closed is a `Modal` with nothing mounted and
    there is nothing to animate on the way out.
  */
  const entrada = useSharedValue(0);
  /** How far the panel has been pulled down, and how far it is willing to go. */
  const arrastre = useSharedValue(0);
  const altoPanel = useSharedValue(0);
  const anchoPanel = useSharedValue(0);
  /**
   * El alto al que el cuerpo **va persiguiendo**, y no el que tiene.
   *
   * Sin esto, cambiar de paso en una hoja de varias páginas —de "opciones" a
   * "editar", del icono a las etiquetas— hace que el panel salte de tamaño de un
   * frame al siguiente. Se nota mucho mas de lo que parece: el salto **mueve el
   * contenido**, y si tenias el dedo o el cursor encima de una fila, esa fila se ha
   * movido sola justo cuando ibas a tocarla.
   *
   * El valor se anima con `withTiming` y el final se escribe al terminar, por el
   * mismo motivo que la entrada: una animacion que no llega a su ultimo frame deja
   * el cuerpo con la altura de antes y la hoja se queda a medias.
   */
  const altoCuerpo = useSharedValue(0);
  /** The height we are already heading for, so the same one is not re-animated. */
  const objetivo = useRef(0);
  /** Whether the pull has already decided to close, so nothing undoes it. */
  const cerrando = useSharedValue(false);
  /** The dimming on its own, so the background does not travel with the panel. */
  const fondo = useSharedValue(0);

  /**
   * Whether the sheet is in the tree at all, **which is not the same as whether
   * it is open**.
   *
   * A `Modal` with `animationType="none"` appears and disappears in one frame, and
   * a sheet that has to be *seen* to go cannot be: the moment `visible` is false
   * the modal is gone and whatever was animating went with it. So the modal is
   * mounted for the whole of the exit and taken down when the exit finishes, and
   * the two states are kept apart on purpose — `visible` is what the caller asks
   * for and `montada` is what is on screen.
   */
  const [montada, setMontada] = useState(false);
  const red = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (visible) {
      setMontada(true);
      arrastre.value = 0;
      cerrando.value = false;
      entrada.value = origin
        ? withSpring(1, MORPH_SPRING)
        : withTiming(1, { duration: DURACION, easing: Easing.out(Easing.cubic) });
      // A shade quicker than the panel: the dimming has to be there *before* the
      // sheet is, or the sheet arrives on a bright screen and the contrast of a
      // white panel on white is the first thing the eye gets.
      fondo.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) });

      /*
        And then the end state is **written whether the animation ran or not**.

        Every animated style here is applied from an animation clock that is the
        browser's own, and a frame that does not arrive leaves the last style it
        did write on the element. That is how this sheet ended up invisible: one
        frame at a low value and then nothing. Writing the final values after the
        animation's own length is the net under it — the animation still plays for
        everybody who can see it, and everybody who cannot gets the sheet open and
        usable instead of a sheet that is not there.

        **And it has to cancel the animations before it writes over them.** Writing
        `1` onto a shared value that a `withTiming` still owns is a race, and the
        race was lost: measured on the web, the net fired on time, wrote one, and
        the animation then wrote its own next frame over the top and the veil was
        left frozen at `opacity: -0.021` — a negative number, which paints nothing
        at all, which is why a sheet could be open and completely undimmed. A net
        that the thing it is protecting can overwrite is not a net.
      */
      clearTimeout(red.current);
      red.current = setTimeout(() => {
        cancelAnimation(entrada);
        cancelAnimation(fondo);
        entrada.value = 1;
        fondo.value = 1;
      }, origin ? MORPH_RED : DURACION + 150);
      return;
    }

    if (!montada) return;
    /*
      The exit, **and it is the entrance backwards.**

      Both values are the same two the entrance moves, so the exit moves them the
      other way: the veil's opacity goes back to zero and the panel's rise goes back
      to a full height, which is the panel **going down off the bottom of the
      screen**. Nothing new is written here and nothing new had to be: a sheet that
      opens by rising and closes by dropping is one movement and its opposite, and
      the code for the second is the first with the numbers swapped.

      **It was 130 milliseconds with `Easing.in`, and that is why it read as no
      animation at all.** `in` is the curve that starts slowly, so of a panel
      travelling its own two hundred points, the first hundred and twenty are done
      in the last thirty milliseconds: the panel sits still and then is gone. The
      eye sees a sheet that did not move and a screen that got lighter. Two hundred
      and forty with a decelerating curve starts moving on the first frame and is
      done, which is a quarter of a second of something leaving.

      Leaving is shorter than arriving — a third of the entrance's three hundred and
      thirty — because nobody wants to wait for a sheet to go, and because the person
      who closed it is already looking at what is behind it.

      And the veil goes on its own clock, a little quicker, so the screen behind is
      already readable while the panel is still on its way down. That order is the
      whole of a sheet that feels like it was put away and not erased.
    */
    clearTimeout(red.current);
    cancelAnimation(entrada);
    cancelAnimation(fondo);

    if (cerrando.value) {
      /*
        Dismissed by the finger, and **the panel is already on its way down**.

        The pull put `arrastre` where the finger let go and sent it further with a
        timing of its own, so animating `entrada` here as well would add a whole
        panel height to a movement the finger already finished and the sheet would
        jump downwards at the moment the hand came off. Only the veil has anything
        left to do.
      */
      fondo.value = withTiming(0, {
        duration: VELO_SALIDA,
        easing: Easing.out(Easing.quad),
      });
    } else {
      entrada.value = withTiming(
        0,
        { duration: SALIDA, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setMontada)(false);
        },
      );
      fondo.value = withTiming(0, {
        duration: VELO_SALIDA,
        easing: Easing.out(Easing.quad),
      });
    }

    red.current = setTimeout(() => {
      /*
        And the last word goes to the net, **with the animations stopped first**,
        for the reason the entrance net has: whoever writes last wins, and a
        cancelled animation cannot write at all. Without the cancel this is a race,
        and the race is lost on a browser that is not painting.
      */
      cancelAnimation(entrada);
      cancelAnimation(fondo);
      setMontada(false);
    }, SALIDA + 90);
  }, [visible, montada, entrada, arrastre, cerrando, fondo]);

  /**
   * The veil's opacity, **and it never leaves the range an opacity can take.**
   *
   * Measured on the web, the value this was reading arrived as `-0.02` — a real
   * number, written by a real animation, and a negative opacity paints nothing at
   * all. So the sheet was open, complete, with its options in it, and the screen
   * behind it was exactly as bright as before, which is the one thing a veil is
   * for.
   *
   * Where the negative came from is the platform's business; what is not the
   * platform's business is that a layer whose whole job is to darken something
   * has no guarantee of darkening it. Clamping here is that guarantee, and it
   * costs nothing when the animation is well behaved, because a well-behaved
   * animation stays inside the range anyway.
   */
  const estiloFondo = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, fondo.value)),
  }));

  /** Ten points and nothing else: the content settles, it does not fade. */
  const estiloContenido = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - entrada.value) * 10 }],
    // Growing out of a button, the content waits for the panel to be big enough
    // to hold it: the scaled-up text of a half-grown panel is not worth seeing.
    ...(origin
      ? { opacity: interpolate(entrada.value, [0.45, 0.9], [0, 1], Extrapolation.CLAMP) }
      : null),
  }));

  /*
    The body's own height, **chasing the content**.

    Zero until the first measurement, and that is not a flash: the panel is still
    rising in, so for those frames there is nothing to give a height to and the
    body takes its natural one — the sheet arrives at the right size in the same
    movement that brings it up.
  */
  const estiloCuerpo = useAnimatedStyle(() => ({
    height: altoCuerpo.value > 0 ? altoCuerpo.value : undefined,
  }));

  /**
   * A new height for the body, and **only if it is really a new one**.
   *
   * The `objetivo` guard is what stops the loop that this would otherwise have:
   * setting the height re-lays-out the content, the content reports a height, and
   * without the guard every frame would start a new animation and the body would
   * chase its own tail forever. It is compared against the **target** and not
   * against the current value, so a measurement that arrives mid-animation is not
   * mistaken for a new one.
   *
   * Scrolling sheets are measured with `onContentSizeChange` and not with
   * `onLayout`, and the reason is that an `onLayout` inside a scroll view reports
   * the height the box was **given**, not the height of what is in it — so once
   * the box has a fixed height, that number never changes again and the animation
   * can never start.
   */
  const fijarAltoCuerpo = useCallback((alto: number) => {
    if (alto <= 0 || alto === objetivo.current) return;
    objetivo.current = alto;
    altoCuerpo.value = withSpring(alto, ALTO_SPRING);
  }, [altoCuerpo]);

  /**
   * The size handler for a scrolling sheet, and it is a named one because a typed
   * arrow written **inside a JSX expression** has to be parsed as JSX before it is
   * read as TypeScript, and `(w: number, h: number)` is exactly the shape that
   * parser has an opinion about.
   */
  const alMedirElContenido = useCallback(
    (_ancho: number, alto: number) => fijarAltoCuerpo(alto),
    [fijarAltoCuerpo],
  );

  /** And on a step change the height starts again, or a short sheet stays short. */
  useEffect(() => {
    if (!visible) return;
    objetivo.current = 0;
    altoCuerpo.value = 0;
  }, [visible, altoCuerpo]);

  /*
    Pulling the sheet down, **on the grabber's strip and nowhere else**.

    The panel follows the finger while it goes down, and goes back if it is let go
    short of the line. Down only: a sheet does not open by being pulled up, and a
    strip that answered both directions would be one control meaning two things.

    **The line is a fifth of the panel's own height and not a number of points.**
    A hundred and twenty points is a long way to drag on a small phone and nothing
    at all on a large one, so the same gesture would close on one screen and not on
    another. Five per cent is the rule both platforms use, and it is measured
    because the panel's height is not known until it has been laid out.

    **The flick closes without travelling the fifth.** Speed is the second test, so
    a quick pull is a quick dismissal and a slow one has to be deliberate. Both
    have to be true of a drag that is cancelled by something else — a second
    finger, a call, the app going to the background — which is what `cerrando` is
    for: without it the sheet springs back after it has already decided to close,
    and the two motions fight.
  */
  const estiloPanel = useAnimatedStyle(() => {
    /*
      Two things move this panel and they do not fight: the **entrance**, which
      brings it up from its own height, and the **drag**, which is the finger. The
      drag wins while it is happening, so it is added on top of the entrance rather
      than compared with it.

      The rise is `height × (1 − entrada)`, and it needs the measured height: a
      `translateY` in percentages is not a thing reanimated can do, and a fixed
      number of points would be a short rise on a small sheet and a long one on a
      tall one. Before the first measurement the height is zero and the panel only
      fades, which for one frame is not something anybody sees.
    */
    const subida = (1 - entrada.value) * altoPanel.value;
    // **No opacity here.** The panel rises; it does not fade in. A fade would put
    // the visibility of the sheet behind an animation, and the one thing that has
    // to be there whatever the animation does is the thing you press.
    if (origin && altoPanel.value > 0 && anchoPanel.value > 0) {
      // The panel is a box that grows from the button's rectangle to its own.
      // It is done with a transform (translate + scale about the centre) and not
      // with `top/left/width/height`, so none of the layout the sheet measures
      // itself with is touched while it moves.
      const p = entrada.value;
      const finalX = anchoVentana / 2;
      const finalY = wide ? altoVentana / 2 : altoVentana - altoPanel.value / 2;
      const dx = origin.x + origin.width / 2 - finalX;
      const dy = origin.y + origin.height / 2 - finalY;
      return {
        opacity: interpolate(p, [0, 0.08], [0, 1], Extrapolation.CLAMP),
        transform: [
          { translateX: (1 - p) * dx },
          { translateY: (1 - p) * dy + arrastre.value },
          { scaleX: origin.width / anchoPanel.value + (1 - origin.width / anchoPanel.value) * p },
          { scaleY: origin.height / altoPanel.value + (1 - origin.height / altoPanel.value) * p },
        ],
      };
    }
    return { transform: [{ translateY: subida + arrastre.value }] };
  });

  const volver = () => {
    'worklet';
    arrastre.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.7 });
  };

  const descartar = Gesture.Pan()
    // A few points, so a tap on the strip is a tap and not the start of a drag.
    .minDistance(4)
    .onUpdate((event) => {
      if (event.translationY > 0) arrastre.value = event.translationY;
    })
    .onEnd((event) => {
      const linea = Math.max(90, altoPanel.value * 0.2);
      if (event.translationY > linea || event.velocityY > 700) {
        /*
          Se pregunta **antes** de comprometerse, y no despues.

          El gesto que cierra ya ha animado el panel hacia abajo y tiene que salir
          en el mismo instante: no hay forma de preguntar nada con el panel fuera
          de la pantalla. Preguntar despues significaria que tirar hacia abajo
          guarda lo que habia sin preguntar, que es justo lo que el resto de las
          cinco salidas evita. Asi que el gesto pide permiso primero y solo empieza
          la salida si le dicen que si — y si no, el panel vuelve a su sitio con
          el mismo rebote de siempre, que es lo que hace un gesto que se arrepiente.
        */
        if (!(runOnJS(preguntarCierre)() as unknown as boolean)) {
          volver();
          return;
        }
        cerrando.value = true;
        // It leaves downwards as the modal fades, so on the web — where the modal
        // has no animation of its own — the sheet is seen to go and not to blink.
        arrastre.value = withTiming(linea * 3, { duration: 180, easing: Easing.out(Easing.quad) });
        runOnJS(onClose)();
        return;
      }
      volver();
    })
    .onFinalize(() => {
      // Reached without `onEnd`, which means the gesture was cancelled rather than
      // finished. If it had already decided to close, this is not its business.
      if (!cerrando.value) volver();
    });

  return (
    <SheetSucioContexto.Provider value={{ sucio, setSucio }}>
    <Modal
      visible={montada}
      transparent
      animationType="none"
      /*
        El boton atras de Android, que llega aqui sin pasar por ningun control. Sin
        esto es la quinta salida — y la que nadie toca en una prueba manual, porque
        probar el guardado pulsando el atras fisico del movil es la forma mas
        rapida de perder el trabajo de un dia.
      */
      onRequestClose={pedirCierre}
      statusBarTranslucent
    >
      {/*
        `GestureHandlerRootView` **inside** the `Modal`, and not only the one in
        `app/_layout.tsx`.

        On Android a React Native `Modal` is not a view: it is a separate native
        window with its own tree. A `GestureDetector` that lives inside it does not
        hang off the app's `GestureHandlerRootView`, and without a root of its own
        **the gesture is never registered**: no error, no crash, the panel opens and
        the finger moves across the square and nothing happens.

        This is what made both colour pickers — the workspace one and the tag one —
        change neither the colour nor the hue on a phone, with `runOnJS` in place and
        without it. Both pickers live inside a `Sheet`, and the `Sheet` is a `Modal`.
        On the web `Modal` is a div in the same tree, `_layout`'s root does cover it,
        and that is why the bug was never visible there.

        This repo has now paid this same bill twice; the first time is written in
        `docs/roadmap.md`: without `GestureHandlerRootView` the gesture handler does
        not set `touch-action: none` and the browser keeps the finger. There it was the
        browser taking the gesture and there was no way to give it back; here it is the
        modal's native window, and there is not either.

        **It goes inside and not around the `Modal`**: a root around the `Modal` is a
        root in the app's window, which is exactly the one that does not contain the
        panel's gestures. And `flex: 1` because this is the view that has to be
        measured, not the content: a container with no height receives no touches,
        which is the same failure shape as the `flex: 1` on the hue strip.
      */}
      <GestureHandlerRootView style={styles.raizGestos} onStartShouldSetResponderCapture={captureTouch}>
      {/*
        `animationType="none"`, **and that is the point of the whole file**.

        It was `slide` on a phone, and the modal is the *root*: the dimming is a
        child of it, so the dimming slid up from the bottom along with the panel.
        The screen behind a sheet does not move — it gets darker — and a dimming
        that travels reads as a second sheet coming up over the first, which is
        why the overlay looked like part of the animation instead of the thing
        that makes the panel readable.

        So the modal does not animate and the two things inside it do, separately:
        the dimming fades and the panel rises. On a wide screen the panel is a
        dialog in the middle, and there it fades rather than rises, because a card
        in the middle of the screen sliding up from the bottom is a card that has
        fallen.
      */}
      {/* The dimming is on this view and not on a separate backdrop view.
          An absolutely positioned backdrop that is a sibling of the panel is
          painted *over* it, because positioned elements paint above the ones in
          normal flow, and on web that left the panel floating on a screen that
          was exactly as bright as before. Painting it here, on the thing that is
          painted first, cannot come out in the wrong order. */}
      {/*
        The container, **and it is never transparent**.

        The dimming was on this view, so it animated this view's opacity, and an
        animation that did not run left the whole sheet at zero and therefore
        invisible: the options were in the document and there was nothing to see.
        A control that can disappear because an animation did not start is not a
        control.

        So the dimming is **its own layer underneath**, and the only thing this
        view is asked to animate is that layer. Whatever the animation does — or
        does not do — the panel is on screen and can be closed.
      */}
      <View
        style={[styles.root, wide ? styles.rootWide : styles.rootNarrow]}
      >
        {/* The dimming, on its own layer, above the app and below the panel. */}
        <Animated.View
          testID="sheet-dim"
          pointerEvents="none"
          style={[
            styles.backdrop,
            { backgroundColor: theme.colors.overlay },
            estiloFondo,
          ]}
        />

        {/* The tap outside closes, which is the only way out on a wide screen
            where there is no edge to drag from. It is there to be pressed, not
            to be seen. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={pedirCierre}
          style={styles.backdrop}
        />

        <Animated.View
          testID="sheet-panel"
          onLayout={(event) => {
            // The height the dismiss line is a fifth of, and it is only knowable
            // once the panel has been laid out.
            const alto = event.nativeEvent.layout.height;
            if (alto > 0) altoPanel.value = alto;
            if (event.nativeEvent.layout.width > 0) anchoPanel.value = event.nativeEvent.layout.width;
          }}
          style={[
            wide ? styles.panelWide : styles.panelNarrow,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              /*
                `paddingBottom`, not `marginBottom` and not a resize.

                The keyboard takes the bottom `teclado` points of the window, and
                the panel's last `paddingBottom` of points is what would be under
                it — so that is what has to grow, not the panel moving up. A
                `margin` would push the whole panel up and take the header with
                it, which is not what happens when a sheet meets a keyboard: the
                sheet stays where it is and the **bottom of its content** comes
                into view.

                And the two are added, not swapped: with the keyboard up the
                gesture bar is behind it, so keeping `insets.bottom` as well only
                adds padding nobody needs. Small, and not worth a conditional for
                a bar that is not even visible while you are typing.
              */
              paddingBottom: teclado + (wide ? theme.spacing.lg : insets.bottom + theme.spacing.lg),
              /*
                Y el alto, que aqui es donde se rompe de verdad: `maxHeight` en
                porcentaje se mide contra la **ventana**, y el teclado no encoge la
                ventana —la encoge la vista—. Un panel al 85% con el teclado abierto
                llega 85% de una ventana que tiene el teclado delante, o sea que su
                mitad de abajo queda debajo del teclado.

                Asi que cuando hay teclado el alto pasa a ser absoluto y sale de lo
                que queda: el alto de la ventana menos el teclado, y del panel solo
                un `maxHeightRatio` de eso. Es la unica forma de que el limite y el
                relleno hablen del mismo sitio.
              */
              ...(teclado > 0
                ? { maxHeight: Math.round(altoVentana * (1 - teclado / altoVentana) * maxHeightRatio) }
                : { maxHeight: `${Math.round(maxHeightRatio * 100)}%` }),
            },
            estiloPanel,
          ]}
        >
          {/*
            The strip you pull, **and it is only the strip**.

            The whole panel is a scroll view, a reorder list with its own drag
            handles, a carousel that scrolls sideways and a colour picker that
            wants the finger; a downward pan on any of those is a gesture that
            already means something else, and a sheet that closes because you were
            halfway through choosing a colour is worse than a sheet that needs the
            two centimetres at the top.

            So the dismiss drag lives on the grabber's own strip, which is empty
            space drawn as a handle — the one place in a sheet where no other
            control can be. Pull it down and it goes; pull it up and nothing
            happens, because a sheet does not open by being pulled.
          */}
          <View style={styles.grabberArea}>
              {/*
                The strip, and the drag is **on it and not on the header**.

                The detector used to wrap the whole header, the title row and the
                cross included, and the cross stopped working: a pan that covers a
                button takes the pointer, so pressing the cross closed nothing.
                A control inside a gesture is not a control, and the cross is the
                way out of a sheet on a screen where there is no edge to drag from.
              */}
              <GestureDetector gesture={descartar}>
                <View style={styles.grabberFila}>
                  <View
                    style={[
                      styles.grabber,
                      { backgroundColor: theme.colors.borderStrong },
                    ]}
                  />
                </View>
              </GestureDetector>
              <View style={styles.cabeceraFila}>
              {/*
                The header row, and **the artwork goes to the left of the text and
                not above it**: a sheet whose title moves down half a line depending
                *whether there is a cover* is a sheet whose close button and grabber
                *move with it. One row, one height, the same whether there is a
                picture or not.
              */}
              {/*
                The back control, **to the left of everything and not inside the
                text block**.

                `styles.close` carries `marginLeft: "auto"`, which is what throws
                the ✕ to the right end. Putting the arrow there would make the two
                fight over one row. So the arrow goes first in the row, the text
                takes what is left, and the ✕ keeps pushing itself right.

                It is the same thirty-point circle as the close, which is the point:
                one sheet, one header, and the two controls that end something —
                one step or all of it — are the same weight to the eye.
              */}
              {onBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={backLabel ?? t("common.back")}
                  hitSlop={10}
                  testID="sheet-back"
                  onPress={onBack}
                  style={({ pressed }) => [
                    styles.back,
                    {
                      backgroundColor: theme.colors.surfaceMuted,
                      borderRadius: theme.radius.pill,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons name="chevron-back" size={18} color={theme.colors.text} />
                </Pressable>
              ) : null}
              {artwork || title ? (
                <View style={[styles.cabecera, { gap: theme.spacing.md }]}>
                  {artwork}
                  {title ? (
                    <View style={{ gap: 2, flexShrink: 1 }}>
                      <AppText variant="heading" numberOfLines={1}>
                        {title}
                      </AppText>
                      {subtitle ? (
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                          {subtitle}
                      </AppText>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              hitSlop={10}
              onPress={pedirCierre}
              style={({ pressed }) => [
                styles.close,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  borderRadius: theme.radius.pill,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="close" size={16} color={theme.colors.text} />
            </Pressable>
              </View>
          </View>

          {/*
            The body, **and the one place the horizontal margin is written**.

            It had none, and the margin was on the two things that live inside it:
            eighteen on the header strip and eighteen on an option row. So a sheet
            that put anything else in the body — a search field, a row of chips, a
            list to reorder — had it flush against the edge of the panel, and the
            two kinds of content in the same sheet sat on two different lines. The
            reorder sheets were the worst: a card of rows with no margin reads as a
            list that has fallen off the panel.

            The margin is here now and off the option row, so everything in every
            sheet lines up on the same eighteen whatever it is.
          */}
          {/*
            El cuerpo va dentro de una caja animada, y **no es por estilo**.

            Es porque un `ScrollView` de React Native no admite un estilo animado, y
            porque la caja es mejor estructura: el alto que persigue el contenido es
            de la **caja**, y lo que scrollea se estira dentro de ella. Animando el
            scroller directamente habria que animar algo que ademas decide su propia
            altura.
          */}
          <Animated.View
            style={[
              estiloCuerpo,
              {
                paddingTop: theme.spacing.sm,
                paddingHorizontal: MARGEN,
              },
            ]}
          >
          {/*
            Los dos cuerpos, **en dos ramas y no en una**.

            `Body` era `scrollable ? ScrollView : View`, y esa union es la que
            rompia: `onContentSizeChange` es del `ScrollView` y el `View` no lo
            tiene, asi que TypeScript rechazaba las props de los dos a la vez. Con
            dos ramas cada una lleva lo suyo y no hay ni un `as` por medio.

            Y el motivo de que la medida no sea un `onLayout` en ninguno de los dos
            esta en el `ScrollView`: un `onLayout` dentro de algo que scrollea
            informa de la altura que **le dieron**, no de la que tiene lo que lleva
            dentro. En cuanto la caja lleva una altura fija, ese numero no vuelve a
            cambiar y la animacion no puede arrancar otra vez — el alto se queda
            clavado en el primer paso y se rompe para siempre. `onContentSizeChange`
            informa del contenido, y el contenido no depende de la caja.
          */}
          {scrollable ? (
            <ScrollView
              style={styles.cuerpoLleno}
              contentContainerStyle={{
                paddingTop: theme.spacing.sm,
                paddingHorizontal: MARGEN,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={alMedirElContenido}
            >
              <Animated.View style={estiloContenido}>{contenido}</Animated.View>
            </ScrollView>
          ) : (
            /*
              Y el que no scrollea **no se anima, y a proposito**.

              Es el mismo bucle del que huye el `onContentSizeChange` de arriba: una
              caja con una altura fija informa de la altura que **le dieron**, asi
              que en cuanto se le pone una el numero se queda clavado y la animacion
              no vuelve a arrancar. aqui el bucle seria peor porque la caja se
              ajusta al contenido y el contenido se mide dentro de ella.

              Y no se pierde nada. Las hojas que no scrollean son las de una sola
              pagina —un menu, una confirmacion, un campo con su boton— y las que
              cambian de alto de verdad son las de varias paginas, que scrollean
              todas. Una hoja que no cambia de pagina tampoco tiene un salto que
              ocultar.
            */
            <View style={styles.cuerpoLleno}>
              <Animated.View style={estiloContenido}>{contenido}</Animated.View>
            </View>
          )}
          </Animated.View>

          {/*
            El boton de Guardar, **al pie y no en la cabecera**.

            La cabecera es donde estan las acciones de la pantalla —volver, cerrar—
            y quien esta escribiendo necesita el boton de confirmar en el sitio donde
            llega el pulgar al terminar. Ademas cabe en un sitio en todas las
            plataformas: abajo siempre hay espacio para el pulgar, y en un dialogo
            centrado no lo hay en ningun sitio.

            Y **solo aparece si hay algo que confirmar**. Una hoja que abre a
            escribir el nombre de una lista tiene Guardar; una hoja de seis
            opciones para leer, no. Un Guardar gris en un menu enseña que el boton
            es decoracion, y a partir de ahi nadie fia de ningun Guardar.
          */}
          {onSave ? (
            <View
              style={[
                styles.pieGuardar,
                {
                  borderTopColor: theme.colors.border,
                  paddingHorizontal: MARGEN,
                  paddingTop: theme.spacing.md,
                  // El teclado se come el borde inferior, y un boton debajo del
                  // teclado es un boton que no se puede pulsar. Mismo relleno que
                  // el panel, por el mismo motivo y con la misma cuenta.
                  paddingBottom:
                    teclado + (wide ? theme.spacing.lg : theme.spacing.lg),
                },
              ]}
            >
              <Button
                testID="sheet-save"
                label={guardando ? t("common.saving") : (saveLabel ?? t("common.save"))}
                onPress={() => void guardar()}
                disabled={guardando || saveDisabledReason !== undefined}
                accessibilityHint={saveDisabledReason}
                fullWidth
              />
            </View>
          ) : null}
        </Animated.View>
      </View>
      {/*
        `GestureHandlerRootView` **dentro** del `Modal`, y no solo el que hay en
        `app/_layout.tsx`.

        En Android un `Modal` de React Native no es una vista: es una ventana nativa
        aparte, con su propio árbol. Un `GestureDetector` que vive dentro de ella no
        cuelga del `GestureHandlerRootView` de la app, y sin una raiz propia **el gesto
        no se registra**: no hay error, no hay crash, el panel abre y el dedo se mueve
        sobre el cuadrado sin que pase nada.

        Esto es lo que hacia que los dos selectores de color —el de workspace y el de
        etiquetas— no cambiaran ni el color ni el tono en un movil, con `runOnJS`
        puesto y sin él. Los dos picker viven dentro de un `Sheet`, y el `Sheet` es un
        `Modal`. En la web `Modal` es un div en el mismo arbol, la raiz de `_layout` si
        lo cubre, y por ahi el bug nunca se vio.

        Es la segunda vez que este repo paga esta misma factura; la primera esta
        escrita en `docs/roadmap.md`: sin `GestureHandlerRootView` el gestor de gestos
        no pone `touch-action: none` y el navegador se queda con el dedo. Ahi era el
        navegador tomando el gesto, y no habia forma dearlo; aqui es la ventana nativa
        del modal, y tampoco.

        **Va dentro y no envolviendo el `Modal`**: una raiz alrededor del `Modal` es
        una raiz en la ventana de la app, que es justo la que no contiene los gestos
        del panel.
      */}
      </GestureHandlerRootView>
    </Modal>

    {/*
      La pregunta va **fuera** del `Modal` del panel y no dentro.

      Un `Modal` de Android es una ventana del sistema, y dos ventanas del sistema
      apiladas en el mismo sitio no se ordenan: la de arriba tiene que ser la
      pregunta, y dentro del panel del sheet lo que se dibujaria encima seria el
      panel, que es justo lo que esta haciendo el gesto del pull. Aparte y por
      encima, que es lo que hace un dialogo.
    */}
    <ConfirmDialog
      visible={preguntando}
      title={t("sheet.unsavedTitle")}
      body={t("sheet.unsavedBody")}
      confirmLabel={t("sheet.unsavedLeave")}
      cancelLabel={t("sheet.unsavedStay")}
      destructive
      onConfirm={salir}
      onCancel={() => setPreguntando(false)}
    />
    </SheetSucioContexto.Provider>
  );
}

export interface SheetOption {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  description?: string;
  tone?: "default" | "danger" | "accent";
  disabled?: boolean;
  /**
   * The option is a choice and this one is the chosen one: a tick on the right.
   *
   * A menu option does not need it, because pressing it *is* choosing it. An
   * option that toggles something the sheet then leaves open does: a picker of
   * what is on the panel has to say which things are on it, and the only place
   * that can be said is the row itself. Without it the state lives in the
   * description, where it is one sentence of every row and the first thing to be
   * read past.
   */
  selected?: boolean;
  /**
   * The option is a door and not a switch: a chevron, and pressing it goes
   * somewhere instead of changing something.
   *
   * The same shape `ListRow` already has, because a row that goes somewhere and
   * a row that does a thing are told apart the same way everywhere in the app.
   */
  chevron?: boolean;
  /**
   * A second control on the right, for the row that is both.
   *
   * A folder in the panel picker is the only thing in the app that is a door and
   * a switch at the same time: pressing the row goes into the folder, and the
   * circle beside it puts the folder on the panel. Folding that into the one
   * pressable is what it was doing before, and one pressable can only answer one
   * question — so the row went into the folder when the folder was not pinned and
   * pinned it when it was, and the chevron and the tick took turns being the
   * right one. A control that changes what it means depending on its own state is
   * a control nobody can predict.
   *
   * So the two are two controls: the row is the door, the circle is the switch,
   * and the circle says in its label which of the two it is doing.
   */
  trailingAction?: {
    accessibilityLabel: string;
    selected: boolean;
    onPress: () => void;
  };
  /**
   * What the line does, and **it is missing when the line is not a door**.
   *
   * A row that says "Ya está en la lista" is a state, and a state that answers to
   * a press is a lie with a finger on it: it looks exactly like the ones that do
   * something and it does nothing. So the type lets the two apart — with
   * `disabled` and no `onPress` it is drawn as a state, and with both it is drawn
   * as an action — instead of forcing the caller to pass a function that does
   * nothing.
   */
  onPress?: () => void;
}

/**
 * The menu of a thing: what you can do with a list, a folder or a space.
 *
 * Destructive options are last and red, so the one that cannot be undone is not
 * the one under the thumb at the top of the panel.
 */
export function SheetOptions({ options }: { options: SheetOption[] }) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {options.map((option, index) => (
        <SheetOptionRow key={option.key} option={option} first={index === 0} />
      ))}
    </View>
  );
}

/**
 * One row of the menu, in its own component so the hint hook is not called
 * once per option inside a loop.
 */
function SheetOptionRow({ option, first }: { option: SheetOption; first: boolean }) {
  const theme = useTheme();
  const t = useTranslation();

  // Optional: an option without a description has nothing to describe.
  /*
   * No hint here, and on purpose: the description is already painted inside the
   * button, so a screen reader reaches it on its own as part of the control.
   * Pointing `aria-describedby` at a second copy of the same sentence means the
   * same words twice — once as the content of the button and once as its
   * description — and the version that is only a hint is the one people learn to
   * skip.
   *
   * The hint is for the descriptions that are *not* on screen: the ones that
   * explain what pressing a button you cannot see the meaning of will do.
   */

  const danger = option.tone === "danger";
  const accent = option.tone === "accent";
  const color = danger
    ? theme.colors.danger
    : accent
      ? theme.colors.accent
      : theme.colors.text;

  /**
   * The second control, read once.
   *
   * A local and not `option.trailingAction` at each use, because the style is a
   * callback that TypeScript will not narrow across: it checks the property on
   * the way in and then cannot promise it is still there inside the closure.
   */
  const trailing = option.trailingAction;

  return (
    <View>
      {first ? null : (
        <View
          style={[
            styles.separator,
            { backgroundColor: theme.colors.border },
          ]}
        />
      )}
      {/*
        The row, and **it is a `Pressable` only when there is something to press**.
         *
        A line that says "Ya está en la lista" is a state, and drawn as a button it
        is a button that does nothing: the same size, the same place, the same
        response to a tap as the ones that work, and the only way to tell is to tap
        it and find out. So the two are different elements and not one element
        with a flag.
      */}
      {option.onPress ? (
      <Pressable
        accessibilityRole="button"
        /*
          The state in words, and not only as `accessibilityState.selected`.
          That attribute has no valid form on a button on the web — a button is
          not an option, so there is no `aria-selected` for it and it is not
          written at all — and what is left telling a chosen row from an
          unchosen one is a tick, which is invisible to a screen reader and to
          anybody who cannot separate the accent from the border.
        */
        accessibilityLabel={
          option.selected ? `${option.label}, ${t("dashboard.pinned")}` : option.label
        }
        disabled={option.disabled}
        onPress={option.onPress}
        style={({ pressed }) => [
          styles.option,
          {
            backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
            opacity: option.disabled ? 0.4 : 1,
          },
        ]}
      >
        {option.icon ? <Ionicons name={option.icon} size={18} color={color} /> : null}
        <View style={[styles.optionText, { gap: 2 }]}>
          <AppText variant="body" style={{ color }}>
            {option.label}
          </AppText>
          {option.description ? (
            <AppText variant="caption" tone="subtle" numberOfLines={2}>
              {option.description}
            </AppText>
          ) : null}
        </View>
        {option.selected ? (
          <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
        ) : option.chevron ? (
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
        ) : null}
        {/*
          The second control, when the row has two things to be.

          Nested inside the row's own `Pressable` on purpose: the circle is the
          switch and the rest of the row is the door, and a finger on the circle
          has to reach the circle and not the row behind it. The circle is bigger
          than the glyph inside it, because it is a target and not an icon, and it
          stops its own press from also opening the folder.
        */}
        {trailing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={trailing.accessibilityLabel}
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              trailing.onPress();
            }}
            style={({ pressed }) => [
              styles.trailing,
              {
                borderColor: trailing.selected
                  ? theme.colors.accent
                  : theme.colors.border,
                backgroundColor: trailing.selected
                  ? theme.colors.accent
                  : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name="checkmark"
              size={12}
              color={
                trailing.selected
                  ? theme.colors.onAccent
                  : theme.colors.textSubtle
              }
            />
          </Pressable>
        ) : null}
      </Pressable>
      ) : (
          /*
            The same row without being a button, for the ones that are a state.
             *
            Same styles, same place, same height — a row that only says "Ya está en
            la lista" and moves half a line when it stops being pressable is a row
            that reflows a menu, and the menu is where you are reading.
          */
          <View style={[styles.option, { backgroundColor: "transparent", opacity: 0.7 }]}>
            {option.icon ? <Ionicons name={option.icon} size={18} color={color} /> : null}
            <View style={[styles.optionText, { gap: 2 }]}>
              <AppText variant="body" style={{ color }}>
                {option.label}
              </AppText>
              {option.description ? (
                <AppText variant="caption" tone="subtle" numberOfLines={2}>
                  {option.description}
                </AppText>
              ) : null}
            </View>
          </View>
        )}
    </View>
  );
}

/** A wide screen is one where a bottom panel is a strip, not a panel. */
export function isWide(): boolean {
  if (Platform.OS !== "web") return false;
  return (globalThis as { innerWidth?: number }).innerWidth
    ? (globalThis as { innerWidth: number }).innerWidth >= 900
    : false;
}

/**
 * The horizontal margin every sheet has, **written once**.
 *
 * Eighteen, because that is what the header strip and the option rows have always
 * used, so nothing that was already inside a sheet moves; what changes is the
 * content that was flush to the edge and now is not.
 */
export const MARGEN = 18;

/** How long the panel takes to arrive, and the net under the animation is this. */
const DURACION = 180;

/** Near critical damping, so the morph settles without a visible bounce. */
const MORPH_SPRING = { damping: 26, stiffness: 190, mass: 1 } as const;
/**
 * The same feel for the body height, so a change of step is a spring and not a
 * tween. `overshootClamping` because a height that overshoots clips the content at
 * the bottom for a frame on the way past; clamped, it only ever arrives.
 */
const ALTO_SPRING = { damping: 26, stiffness: 220, mass: 1, overshootClamping: true } as const;
/** Net under the morph: it has to outlast the spring, or it cuts it. */
const MORPH_RED = 1100;

/**
 * How long it takes to **go**, for the panel and for the veil.
 *
 * Leaving is slower than the veil on purpose. The panel is the thing being put
 * away and it is the thing the eye is on, so it gets two hundred and forty
 * milliseconds to travel its own height; the veil gets a hundred and eighty, which
 * is already the screen behind being readable by the time the panel is halfway
 * down. The veil arriving faster than the panel leaves is what makes a sheet feel
 * like it was put away rather than erased, and the other way round — a panel gone
 * under a still-dark screen — is the version that reads as a flicker.
 */
const SALIDA = 240;
const VELO_SALIDA = 180;

/**
 * The last thing the sheet was showing, **for the time it takes to stop showing it.**
 *
 * A sheet of options is written as `if (!folder) return null`: the caller says the
 * menu is closed by handing over nothing, and the component does the obvious thing
 * with nothing. **That is what makes every sheet in this app vanish without moving.**
 *
 * The exit is drawn inside the sheet and takes a quarter of a second, and the
 * caller takes the sheet out of the tree in the frame the dismissal is requested —
 * so the panel's journey down happens inside a component that no longer exists, and
 * what is left is the veil, which is on a layer above and outlives it for a few
 * frames. Measured on the web: the panel was gone **forty-five milliseconds** after
 * the cross was pressed, and the two hundred and forty of the animation were never
 * on screen.
 *
 * This hook is the half of the contract the caller was missing. It remembers the
 * value and gives it back, so the sheet keeps rendering the folder it was showing
 * while the caller has already moved on — and the caller asks for the dismissal by
 * passing `visible={false}`, which is the thing the sheet already knows how to
 * animate.
 *
 * **It holds the last value and not the new one**, so `visible` is driven by the
 * original argument and this only ever fills in what is on screen:
 *
 * ```tsx
 * const ultimo = useLastValue(folder);
 * if (!ultimo) return null;
 * <Sheet visible={folder !== null} …>{/* renders `ultimo` *\/}</Sheet>
 * ```
 */
export function useLastValue<T>(valor: T | null | undefined): T | null {
  const guardado = useRef<T | null>(null);
  if (valor != null) guardado.current = valor;
  return guardado.current;
}


const styles = StyleSheet.create({
  /*
    The gesture root's own style, and it is only `flex: 1` because it has to be
    measured. It is the direct child of the `Modal`, so it is what gives the modal's
    window its size; a root that collapsed to zero would leave the panel unmeasurable
    and a view with no height takes no touches.
  */
  raizGestos: {
    flex: 1,
  },
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  rootNarrow: {},
  rootWide: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  /**
   * The foot with the Save button, **outside the area that scrolls**.
   *
   * A sibling of `Body` and not inside it: a Save inside the scroll goes away with
   * the contents on a long sheet, and the confirming button disappears exactly
   * when it is most needed, which is when the contents are long.
   */
  pieGuardar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /**
   * El scroller dentro de la caja animada, estirado a ocuparla entera.
   *
   * `flex: 1` y no una altura: la caja es la que tiene el alto que persigue al
   * contenido, y el scroller tiene que **`stretch` con ella**. Sin esto, el
   * scroller mide lo que mide su contenido y la animacion no llega a verse, porque
   * la caja crece y el scroller no la sigue.
   */
  cuerpoLleno: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panelNarrow: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  panelWide: {
    width: 460,
    maxWidth: "100%",
    borderRadius: 18,
    borderWidth: 1,
    paddingTop: 14,
    // `boxShadow` and not the `shadow*` family: React Native Web dropped those
    // props and warns on every render, and the new architecture takes the CSS
    // form on native too, so one property covers the three targets.
    boxShadow: "0px 12px 30px rgba(0, 0, 0, 0.35)",
    elevation: 12,
  },
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * The strip at the top of a sheet: **the grabber on its own line, and the
   * title under it.**
   *
   * It was one row with `flexDirection: "row"`, which put the thirty-eight point
   * pill to the **left of the title** with ten points of gap between them — a
   * grey bar sitting beside the words rather than the thing you are meant to pull.
   * Every bottom sheet on both platforms puts the grabber above the title and
   * centred, and it is not a matter of taste here: it is the same strip you drag
   * to dismiss, and a handle that is not above the content does not read as
   * "pull me".
   */
  grabberArea: {
    paddingHorizontal: MARGEN,
    paddingTop: 8,
    paddingBottom: 6,
  },
  grabberFila: {
    alignItems: "center",
    // The touch target, and it is much taller than the four point line it draws.
    // The line is a drawing; what a finger has to hit is a strip.
    paddingVertical: 8,
  },
  cabeceraFila: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
  },
  close: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  /**
   * The back control, and **the same circle as `close` without the `auto` margin**.
   *
   * The margin is the whole difference. `close` needs it to reach the right end;
   * the arrow has to be the first thing on the row, and taking it away is what
   * leaves room for the title instead of letting the two push each other around.
   */
  back: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    // The horizontal margin is the body's, and not this row's: an option that
    // carried its own eighteen sat thirty-six in from the edge of a body that
    // also has eighteen, and the two never lined up.
  },
  optionText: {
    flex: 1,
  },
  trailing: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  separator: {
    height: 1,
    /** The line starts where the text of the option starts, not at the edge. */
    marginLeft: 48,
  },
});
