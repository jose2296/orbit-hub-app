import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { BackButton } from '@/components/ui/breadcrumbs';
import { DrawerButton } from '@/components/layout/drawer';
import { useHeaderActionSlot } from '@/components/ui/header-action';
import { AppText } from '@/components/ui/text';
import { SpaceWash } from '@/components/ui/wash';
import { ALTO_LAVADO, VELO, type WashVariant } from '@/lib/workspace/wash';
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
  options: { title?: string; espacio?: EspacioHeader | null; [key: string]: unknown };
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

  return (
    <View
      style={[
        styles.caja,
        {
          backgroundColor: theme.colors.background,
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
            style={styles.lavado}
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
        <View style={[styles.lado, { paddingLeft: theme.spacing.xs + theme.spacing.lg }]}>
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
        <View style={styles.centro} pointerEvents="none">
          {typeof options.title === 'string' && options.title.length > 0 ? (
            <AppText
              variant="heading"
              numberOfLines={1}
              style={[styles.titulo, { color: theme.colors.text }]}
            >
              {options.title}
            </AppText>
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
        <View style={styles.derecha}>{slotAccion()}</View>
      </View>
    </View>
  );
}

/** The height of the bar, and the height its controls are centred within. */
const ALTO = 56;


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
       que se ha traido aqui tal cual, con el mismo orden: menu y despues atras. */
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centro: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
