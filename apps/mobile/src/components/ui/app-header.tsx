import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/ui/breadcrumbs';
import { DrawerButton } from '@/components/layout/drawer';
import { useHeaderActionSlot } from '@/components/ui/header-action';
import { FullTitle } from "@/components/media/full-title";
import { CompartirBadge } from "@/components/shares/compartir-badge";
import { SpaceWash } from '@/components/ui/wash';
import {
  ALTO_LAVADO,
  altoLavadoDe,
  VELO,
  type WashVariant,
} from '@/lib/workspace/wash';
import { useTheme } from '@/theme';

/** What a screen publishes about its space, read from the header options. */
export interface EspacioHeader {
  color?: string | null;
  colorTo?: string | null;
  wash?: WashVariant | null;
}

/**
 * The app's own header, because the navigator's only takes one flat colour.
 *
 * **Why this file exists.** The header is where a space's colour belongs now that
 * the bands are gone, and it is the one view that cannot be given a gradient:
 * `headerStyle` takes a `backgroundColor`. A flat colour there worked and it was a
 * lie of a kind — the panel's cards, the list of spaces and this header would have
 * been three different colours for the same space, and "a space is the same colour
 * everywhere" would have quietly become "each place does its own thing".
 *
 * So the header is drawn here, with the **same component and the same pair** that
 * paints the cards. That is the whole point: one wash in this app, two things use
 * it, and they cannot drift.
 *
 * **Drawing it here is also what fixes the content sliding under it.** With
 * `headerTransparent` on the navigator's own header the content goes underneath —
 * measured, the list's own heading printed on top of the screen's title. The
 * navigator still reserves the space for whatever this returns, so the height is
 * whatever this view measures: no constant to hardcode, no platform to get wrong.
 */
/**
 * What the navigator hands a custom header, written out and not imported.
 *
 * `@react-navigation/native-stack` is not a dependency of this project — the
 * stack comes from `expo-router` — so its prop type is not something to import.
 * These are the five things a header can be given, and a header that needs a
 * sixth one is a header doing too much.
 */
export interface AppHeaderProps {
  /*
    `back` va tipado a propósito: lo que pasa el navegador es una función que
    devuelve un **descriptor** —un botón con título y href, que expo-router
    convierte en botón— y no un elemento. Tiparlo como "devuelve un ReactElement"
    es justo lo que no es, y declararlo así es como una cabecera acaba pintando
    un objeto.
  */
  options: {
    title?: string;
    espacio?: EspacioHeader | null;
    /**
     * Si esto esta compartido, y por quien.
     *
     * Va en `options` y no en un contexto porque **es de la pantalla**: un icono
     * de "compartido" que se hereda de donde vino la navegacion acaba poniendose
     * en pantallas donde no aplica.
     */
    compartido?: {
      node?: { nodeType: 'workspace' | 'folder' | 'list' | 'note'; id: string } | null;
      conmigo?: boolean;
      onShare?: () => void;
    };
    [key: string]: unknown;
  };
  /*
    `back` no se usa, y no por descuido. Aqui llega como un **descriptor** —el
    titulo y el href de donde se vuelve— y no como un boton, porque el boton de
    atras de esta app lo dibuja el propio layout en `headerLeft`, junto al menu,
    en el orden en que el pulgar ya los busca. Pedirlo aqui seria dibujarlo dos
    veces.
  */
  children?: ReactNode;
  headerLeft?: (() => ReactNode) | undefined;
  headerRight?: (() => ReactNode) | undefined;
  [key: string]: unknown;
}

export function AppHeader({ options, children }: AppHeaderProps) {
  const theme = useTheme();
  const compartido = options.compartido ?? {};

  /*
    Los controles los pone esta cabecera y no llegan del navegador.

    Escribiendo `header` se espera que el navegador pase `headerLeft` y
    `headerRight`, y **no los pasa**: medido, la cabecera salia con el degradado
    correcto y sin menu, sin atras y sin los tres puntitos. Asi que se leen de
    donde ya estaban —el proveedor de acciones de la cabecera— y los dos botones
    de la izquierda se dibujan aqui, con **el mismo margen medido** que tenian
    (`xs + lg`, por el voladizo de ocho pixeles del hueco del navegador). Ponerlos
    aqui no es una reinvencion: es que ahora la cabecera es nuestra, y una pieza
    nuestra que deja la mitad de los controles en otro sitio es media medida.
  */
  const slotAccion = useHeaderActionSlot();

  /*
    The space, when the screen published one with `useScreenSpace`. A screen that
    is not in a space publishes nothing, so this is null and the header is the
    theme's own background: one rule, and the eleven screens outside a space did
    not have to be taught anything.
  */
  const espacio = (options as { espacio?: EspacioHeader | null }).espacio ?? null;

  /*
    El hueco de la barra de estado, y **la barra lo gasta, no el contenido**.

    Measured on an Android release build (API 35): the bar was `[0,0]-[1080,147]`,
    exactly the 56 points it declares, and its buttons sat at y = 8..48 with the
    status bar at y = 0..24 — under the clock, where a finger cannot hit them. The
    navigator draws this header from the top of the window and does not inset it,
    and `Screen`'s `SafeAreaView` insets the *content*, which is why the two look
    right on paper and the header still lands under the clock: nothing was ever
    reading `insets.top` here.

    The inset goes on the box, so the bar grows by it and the wash — which is
    `styles.fondo`, absolute and full — still paints behind the status bar. That
    is the arrangement worth having: the colour runs to the top edge and the
    controls sit under it.

    **And only here.** `Screen` would add the same inset again on the content
    below, which is how a phone with a notch ends up with a bar of 24 points and a
    page that starts another 24 points down. `HeaderOwnsTopInset` is how the two
    halves agree without every screen having to know.
  */
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.caja,
        {
          backgroundColor: theme.colors.background,
          paddingTop: insets.top,
          minHeight: ALTO + insets.top,
          // **Sin filo, nunca.** Con lavado el desvanecido ya separa, y una linea de
          // un pixel seria el corte que el desvanecido acaba de borrar. Sin lavado
          // la barra se apoyaba en un hilo de color para separarse del contenido, y
          // ese hilo se veía como un borde raro debajo de la barra: medido, es la
          // linea que aparecia entre el desvanecido y la primera fila.
          borderBottomWidth: 0,
        },
      ]}
    >
      {espacio ? (
        /*
          El lavado de la barra, y **llega hasta su borde sin apagarse**.

          Antes se desvanecía dentro de la barra, con lo que en su borde de abajo ya
          era el color del fondo; y entonces la banda de debajo, que vuelve a
          empezar con el color entero, se találaba contra ella. Dos mitades que cada
          una se apaga en su propio borde dejan un escalón de saturación justo
          donde el ojo ya espera un cambio de pantalla.

          Así que la barra **no se apaga**: pinta el color entero y lo corta en seco
          en su borde, y la banda de `Screen` lo recoge desde ahí y es la única que
          se desvanece, 100 puntos más abajo. Un solo lavado, un solo desvanecido y
          una sola costura.
        */
        <View style={styles.fondo} pointerEvents="none">
          <SpaceWash
            colorKey={espacio.color}
            colorToKey={espacio.colorTo}
            wash={espacio.wash ?? undefined}
            style={[styles.lavado, { height: altoLavadoDe(insets.top) }]}
          />
          {/* El velo, y es el **mismo** que el de la banda de `Screen`. */}
          <View
            style={[
              styles.velo,
              { backgroundColor: theme.colors.background, opacity: VELO },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.fila}>
        <View style={[styles.lado, { paddingLeft: theme.spacing.xs + theme.spacing.lg, width: LADO }]}>
          <DrawerButton />
          <BackButton />
        </View>

        {/*
          El titulo con el color del tema, y no con el que el wash dice que va
          encima de el. Con el velo de por medio ese wash ya no es el fondo real
          del titulo, y una respuesta que se dio para un fondo que ya no esta
          debajo es una respuesta a otra pregunta. El color del tema es lo unico
          que se puede prometer que se lee, porque es el color que hay bajo el velo.
        */}
        {/*
          `box-none` and not `none`, because the title inside is now pressable.

          The centre of a bar has to let touches through to the screen underneath
          it, or a tap in the middle of the header does nothing at all — that is
          what `none` was for. `box-none` is the version of that which still lets
          the **children** be touched, which is the one thing the long press on a
          long list name needs, and the box itself is as transparent to touches as
          it was.
        */}
        <View style={styles.centro} pointerEvents="box-none">
          {typeof options.title === 'string' && options.title.length > 0 ? (
            /*
              The name in the bar, **and the whole of it on a long press**.

              It is one line in a bar that is a third of the screen wide and shared
              with a back arrow and a menu, and the names that land there are the
              ones somebody typed: a list called "Cosas que comprar para el piso de
              la abuela" is a third of a word here. The bar itself is not pressable,
              so this one needs no guard.
            */
            <View style={styles.tituloYInsignia}>
              <FullTitle
                text={options.title}
                numberOfLines={1}
                variant="heading"
                style={[styles.titulo, { color: theme.colors.text }]}
                testID="titulo-cabecera"
              />
              {/* La insignia de "compartido", **debajo del titulo y no en un hueco de
                  la barra**. Al lado del texto tendria que competir con el nombre
                  por el ancho de una linea que ya es de las mas cortas que hay, y
                  ademas no cabe en una columna de 96. Debajo se lee como lo que es:
                  una nota sobre lo que estas mirando. */}
              <CompartirBadge
                node={compartido.node ?? null}
                compartidoConmigo={compartido.conmigo ?? false}
                onShare={compartido.onShare}
              />
            </View>
          ) : (
            children
          )}
        </View>

        {/*
          The actions, and the wrapper is `minHeight: ALTO` with the button
          centred inside: a `size="sm"` button is 32 points tall in a 56-point bar
          and it aligns to the top by itself, which put the three dots visibly
          above the line of the title. The height is here, not in the button,
          because the button does not know how tall the bar is.
        */}
        {/*
          El mismo margen que el lado izquierdo, y no ninguno.

          La fila de la izquierda lleva `paddingLeft: xs + lg` y la de la derecha
          no llevaba nada: los tres puntitos se pegaban al borde de la pantalla
          mientras el menu de hamburguesa estaba a una unidad del. Los dos son
          botones de 32 en una barra de 56, y que uno llegue al borde y el otro
          no es lo que hace una barra.

          Y el mismo, y no uno cualquiera: **el del lado que tiene un boton menos**
          es el que hay que igualar, porque es el que iguala los centros.
        */}
        <View
          style={[
            styles.derecha,
            { paddingRight: theme.spacing.xs + theme.spacing.lg, width: LADO },
          ]}
        >
          {slotAccion()}
        </View>
      </View>
    </View>
  );
}

/** The height of the bar, and the height its controls are centred within. */
const ALTO = 56;

/**
 * El ancho de **los dos** lados de la barra, y el mismo a los dos.
 *
 * El titulo vivia en un `flex: 1` con `alignItems: center`, o sea centrado en el
 * **espacio que sobra**. Ese espacio no estaba centrado porque el lado izquierdo
 * tiene dos botones —el menu y el atras— y el derecho uno: los tres puntitos. Con
 * dos botones a un lado y uno al otro, el sobrante se reparte en 104 y 72, y el
 * titulo se va 16 puntos hacia el lado corto. En el panel, sin atras, se centraba.
 * Ese "a veces" es lo que hace que parezca que el titulo baila.
 *
 * Igualar los margenes no lo arregla, porque lo que estaba descentrado era el
 * **ancho**, no el margen. Lo que lo arregla es que los dos lados ocupen lo
 * mismo, y con eso el sobrante queda centrado **por construccion** y no por
 * suerte.
 *
 * Y la justificacion va espejada —el izquierdo al principio, el derecho al
 * final— para que los botones **no se muevan**: cada uno se queda donde estaba y
 * lo que cambia es el ancho de su columna. Un titulo centrado a costa de mover
 * los botones es un intercambio, no una correccion.
 *
 * El ancho sale de lo que el lado izquierdo necesita de verdad: su margen
 * exterior (`xs + lg` = 20), el menu, que son 40 con `marginLeft: -8` —o sea 32—
 * y el atras, 40. Son 92, y se redondea a 96 para que el mas largo de los dos
 * quepan sin recortar.
 */
const LADO = 96;


const styles = StyleSheet.create({
  caja: {
    /*
      **Alto fijo, y el mismo en todas las pantallas.** Antes esta caja media la
      barra **mas el desvanizado**, asi que el contenido de cada pantalla empezaba
      28 puntos mas abajo y dos pantallas con la misma barra no tenian la misma
      linea de titulo. Un alto que depende de otra cosa no es un alto: es un alto
      que hay que acertar. La barra mide `ALTO` y el desvanizado va **dentro**, con
      lo que el corte se apaga antes del borde sin mover el contenido.
    */
    minHeight: ALTO,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fondo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  lavado: {
    /*
      **La mitad de arriba del mismo degradado.** Mide el lavado entero, no la
      barra, y la caja de la barra lo recorta: de los 156 puntos solo se ven los
      56 de arriba. Por eso el angulo no depende de cuanto mida la barra y la
      banda de debajo sigue el mismo degradado sin que haya nada que emparejar.

      **Y el alto lo pone `altoLavadoDe(insets.top)`, no este 156.** La barra
      crecio cuando empezo a gastar el hueco de la barra de estado, y esta caja
      tiene que crecer con ella: es un degradado partido en dos, y el corte es el
      borde de abajo de la barra. Una caja de 156 bajo una barra de 80 pinta el
      degradado hasta el 80 mientras la banda empieza su mitad en el 56, y las dos
      mitades se encuentran en puntos distintos de la misma rampa: un escalon de
      36/255 medido a lo largo de una sola linea. `altoLavadoDe` hace que el corte
      y la barra sean el mismo numero, y con un hueco de cero es el 156 de antes.
    */
    height: ALTO_LAVADO,
  },
  velo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ALTO,
  },
  lado: {
    /* En fila y no en columna: el boton de atras va **al lado** del menu, y con
       una columna se caia debajo. Es la disposicion que el layout tenia antes y
       que se ha traido aqui tal cual, con el mismo orden: menu y despues atras.
       Y `flex-start`, no `center`: la columna tiene ancho fijo para que las dos
       midan igual, y centrar aqui moveria el menu hacia dentro. Cada boton se
       queda en su lado. */
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  centro: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * El titulo y la insignia, **centrados los dos sobre la misma columna**.
   *
   * El titulo solo esta centrado si el bloque que lo contiene tambien lo esta, y
   * por eso van juntos: si la insignia fuera hermana del `View` del centro, el
   * titulo se centraria contra el ancho de la barra entera y bajaria medio punto
   * cada vez que la insignia aparece o desaparece.
   */
  tituloYInsignia: {
    alignItems: 'center',
    maxWidth: '100%',
  },
  titulo: {
    fontWeight: '600',
  },
  derecha: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: ALTO,
  },
});
