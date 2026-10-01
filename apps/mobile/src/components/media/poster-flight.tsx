import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Where something is on the screen, in points, measured by the thing itself. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One poster on its way from a card to a detail, **and the two places it is
 * measured in.**
 *
 * The starting rectangle is measured by the card when it is pressed, and the
 * destination by the detail when it has drawn itself. Neither is guessed and
 * neither is derived from a layout: a card knows where it is, and a detail that
 * has just been laid out knows where it is, and a number written down by hand
 * would be a number that is wrong on the first device somebody tries it on.
 *
 * **The title travels in the same flight, with its own two rectangles**, because a
 * poster that shrinks on its own is read as a picture being resized. The title
 * going with it is what makes the two read as one thing arriving somewhere.
 */
export interface Vuelo {
  id: string;
  /** The picture, or null for a row that has none — the flight still happens. */
  uri: string | null;
  titulo: string;
  desde: Rect;
  tituloDesde: Rect;
  destino: Rect | null;
  tituloDestino: Rect | null;
}

/** How long the poster is in the air. A fifth of a second, for a long way. */
const DURACION = 320;

/**
 * The context every part of this talks through, **and it is inert on the web.**
 *
 * On the web the browser does this itself: the two elements carry the same
 * `view-transition-name` and the browser morphs one into the other with the real
 * ones, at the right pixel ratio, for free and correctly. Doing it again by hand
 * on top would be two posters drawn in two places for the length of a transition,
 * and the hand-made one would be the one you saw.
 *
 * So this exists **only because the phone has nothing**. Reanimated has a shared
 * element transition and it is behind a flag compiled into the native module with
 * no setter from JavaScript — checked in the built `libreanimated.so`, not in its
 * documentation. The way to have it on a phone without patching the library is to
 * do what the browser does: a copy of the thing, drawn above everything, moved
 * from where it was to where it is going.
 */
interface VueloCtx {
  /** Called by the card when it is pressed. Does nothing on the web. */
  iniciar: (v: Omit<Vuelo, "destino" | "tituloDestino">) => void;
  /**
   * Called by the detail **when it has drawn the cover and the title.**
   *
   * It is a report and not a command: the flight only starts once somebody has said
   * where it is arriving, so a screen that never draws a cover — a row with no
   * picture, a failed request — never leaves the poster stranded in the air.
   */
  destino: (v: { destino: Rect; tituloDestino: Rect }) => void;
  /** Called when the flight has landed, and by the screen that is going away. */
  limpiar: () => void;
  /** Whether a flight for this title is in the air, so its own cover can hide. */
  volando: (id: string) => boolean;
}

const Contexto = createContext<VueloCtx | null>(null);

export function usePosterFlight(): VueloCtx {
  const valor = useContext(Contexto);
  if (!valor) {
    /**
     * Outside the provider is not an error, and that is deliberate: the flight is
     * an enhancement, and a card in a tree that nobody wrapped should still press.
     * So the calls land on nothing rather than throwing in a gesture handler.
     */
    return {
      iniciar: () => {},
      destino: () => {},
      limpiar: () => {},
      volando: () => false,
    };
  }
  return valor;
}

/**
 * Whether a flight has the two rectangles it needs to be drawn from, **checked by
 * the numbers being numbers and not by them being truthy.**
 *
 * A rectangle whose `x` is 0 is a real one — the top edge of the screen — and
 * asking "is there something there?" would throw that one away, which is a bug
 * that would only show on the title that happens to be flush against the top.
 */
function esRectangulo(rectangulo: Rect | null | undefined): rectangulo is Rect {
  return (
    typeof rectangulo?.x === 'number' &&
    typeof rectangulo?.y === 'number' &&
    typeof rectangulo?.width === 'number' &&
    typeof rectangulo?.height === 'number' &&
    rectangulo.width > 0 &&
    rectangulo.height > 0
  );
}

/** A flight can be drawn only with both of its starting rectangles. */
function esDibujable(vuelo: Vuelo | null): vuelo is Vuelo {
  return Boolean(vuelo && esRectangulo(vuelo.desde) && esRectangulo(vuelo.tituloDesde));
}

export function PosterFlightProvider({ children }: { children: ReactNode }) {
  const [vuelo, setVuelo] = useState<Vuelo | null>(null);
  /**
   * A flight with no destination, **given a moment to find one and then dropped.**
   *
   * The report comes from a layout that may never happen — a detail that turns out
   * to be an error, a row with nothing to draw — and without this the poster would
   * sit above the whole app for ever, which is a much worse failure than not
   * animating.
   */
  const abandono = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const empezar = useCallback((v: Omit<Vuelo, "destino" | "tituloDestino">) => {
    if (Platform.OS === "web") return;
    clearTimeout(abandono.current);
    setVuelo({ ...v, destino: null, tituloDestino: null });
  }, []);

  const destino = useCallback((v: { destino: Rect; tituloDestino: Rect }) => {
    clearTimeout(abandono.current);
    setVuelo((antes) => (antes ? { ...antes, ...v } : antes));
  }, []);

  const limpiar = useCallback(() => {
    clearTimeout(abandono.current);
    setVuelo(null);
  }, []);

  const volando = useCallback((id: string) => Boolean(vuelo?.id === id), [vuelo]);

  const valor = useMemo(
    () => ({ iniciar: empezar, destino, limpiar, volando }),
    [empezar, destino, limpiar, volando],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/*
        The copy, **above everything and not inside any screen.**

        And whether it exists at all is decided *here* rather than inside: a
        component that returns early has not called its hooks, and React does not
        allow that to change between renders — and here it has to, because "the
        destination has not been reported yet" becomes "it has" a moment later. So
        asking inside meant asking after the hooks had already read the rectangle,
        and a measurement that came back short took the whole navigator down with
        it. Asked here, a flight without two sane rectangles simply is not a copy,
        and the real screen underneath — already drawn by the app — is what the
        person sees. Which is exactly what the browser does on the web when it
        declines to pair a name.
      */}
      {Platform.OS === "web" || !esDibujable(vuelo) ? null : (
        <CopiaEnVuelo vuelo={vuelo} alAterrizar={limpiar} />
      )}
    </Contexto.Provider>
  );
}

/**
 * The poster and the title, drawn in one place, **moved from one rectangle to
 * another.**
 *
 * Both rectangles are in the same animation and neither has its own: a poster that
 * arrives while its title is still travelling reads as two things that happened to
 * be near each other.
 */
function CopiaEnVuelo({
  vuelo,
  alAterrizar,
}: {
  vuelo: Vuelo;
  alAterrizar: () => void;
}) {
  const { desde, destino, tituloDesde, tituloDestino } = vuelo;

  const t = useSharedValue(0);
  /** Whether the flight has already run, so it does not run twice on a re-render. */
  const volandoYa = useRef(false);

  const ir = destino && tituloDestino;

  if (ir && !volandoYa.current) {
    volandoYa.current = true;
    t.value = withTiming(1, { duration: DURACION, easing: Easing.inOut(Easing.cubic) }, () =>
      alAterrizar(),
    );
  }

  /**
   * The two rectangles the flight interpolates between, **and why the closures read
   * them defensively.**
   *
   * They are read inside worklets, which run after this function has returned, so
   * the narrowing that the `if` below does does not reach them. The fallbacks are
   * the starting rectangle — which is what "no destination yet" means anyway: the
   * copy is exactly on the card it came from.
   */
  const estiloPortada = useAnimatedStyle(() => ({
    left: desde.x + ((destino?.x ?? desde.x) - desde.x) * t.value,
    top: desde.y + ((destino?.y ?? desde.y) - desde.y) * t.value,
    width: desde.width + ((destino?.width ?? desde.width) - desde.width) * t.value,
    height: desde.height + ((destino?.height ?? desde.height) - desde.height) * t.value,
    borderRadius: 12 * (1 - t.value),
    // The copy is only needed while the real one is hidden, so it fades out at the
    // very end — otherwise the two overlap for a frame and the edge doubles.
    opacity: 1 - Math.max(0, (t.value - 0.92) / 0.08),
  }));

  const estiloTitulo = useAnimatedStyle(() => ({
    left: tituloDesde.x + ((tituloDestino_?.x ?? tituloDesde.x) - tituloDesde.x) * t.value,
    top: tituloDesde.y + ((tituloDestino_?.y ?? tituloDesde.y) - tituloDesde.y) * t.value,
    opacity: 1 - Math.max(0, (t.value - 0.9) / 0.1),
  }));

  const escalaTitulo = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX:
          1 +
          ((tituloDestino_ ? tituloDestino_.width / Math.max(1, tituloDesde.width) : 1) - 1) *
            t.value,
      },
      {
        scaleY:
          1 +
          ((tituloDestino_ ? tituloDestino_.height / Math.max(1, tituloDesde.height) : 1) - 1) *
            t.value,
      },
    ],
  }));

  /*
    The provider has already refused to render this unless both rectangles are
    numbers, so the ones destructured here are real and are read without a question
    mark. `destino` still may be absent — that is a flight that has not landed yet
    — and it is the one that is asked about.
  */
  const destino_ = destino;
  const tituloDestino_ = tituloDestino;
  if (!destino_ || !tituloDestino_) {
    // Waiting for the destination: the copy sits exactly on the card it came from,
    // which is what the eye expects, and nothing else has to be hidden.
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {vuelo.uri ? (
          <Animated.View style={[styles.copia, { left: desde.x, top: desde.y, width: desde.width, height: desde.height, borderRadius: 12 }, estiloPortada]}>
            <Animated.Image source={{ uri: vuelo.uri }} style={styles.relleno} resizeMode="cover" />
          </Animated.View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {vuelo.uri ? (
        <Animated.View style={[styles.copia, styles.izquierda, estiloPortada]}>
          <Animated.Image source={{ uri: vuelo.uri }} style={styles.relleno} resizeMode="cover" />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[styles.titulo, { left: tituloDesde.x, top: tituloDesde.y }, estiloTitulo]}
      >
        <Animated.View style={escalaTitulo}>
          <Text style={styles.textoTitulo} numberOfLines={1}>
            {vuelo.titulo}
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  copia: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  izquierda: {
    left: 0,
    top: 0,
  },
  relleno: {
    width: '100%',
    height: '100%',
  },
  titulo: {
    position: 'absolute',
    maxWidth: '100%',
  },
  textoTitulo: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0E1220',
  },
});