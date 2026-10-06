import { useCallback, useState } from "react";
import { RefreshControl } from "react-native";
import type { RefreshControlProps } from "react-native";

import { syncNow } from "@/lib/offline/sync-engine";
import { useTheme } from "@/theme";

/**
 * Tirar hacia abajo recarga, y sale **listo paraZrcolgar** en cualquier scroller.
 *
 * Vive en un hook y no dentro de `Screen` porque **`Screen` no es el unico que
 * scrollea**. El scroller de la pantalla esta dentro de `Screen` solo cuando
 * `scroll` es cierto, y las pantallas que tienen una lista de verdad —la de la
 * tarea, la de una carpeta grande— pasan `scroll={false}` y traen su propio
 * `FlatList`. Con el refresh dentro de `Screen`, esas pantallas no lo tenian: y
 * la de la lista, que es la que mas se mira, era justo una de las que no.
 *
 * Que se vea "dentro de carpetas" y no en la lista no era una coincidence ni un
 * fallo de criterio: era exactamente el conjunto de pantallas que dejan el
 * scroller en manos de `Screen`.
 *
 * ## Que es y que no es
 *
 * El motor **ya sincroniza solo**, con su rebote y cuando vuelve la red. Esto no
 * es lo que hace que los datos esten al dia: es la salida para cuando sabes que
 * algo cambio y no quieres esperar. Y es, sobre todo, lo unico que hay en la
 * **web**, donde no hay gesto de tirar del sistema al que agarrarse.
 *
 * Tira de `syncNow()` y no de un `pull` suelto porque el motor ya sabe lo que
 * tiene y lo que no, y **una segunda ruta para bajar cambios es una segunda ruta
 * para equivocarse**.
 *
 * ## Y el indicador se apaga en `finally`
 *
 * Sin red —o con el servidor caido— un `await` sin `finally` deja el indicador
 * girando para siempre. Eso se lee como "sincronizando" en pantalla, con algo que
 * no va a pasar nunca.
 */
export function usePullToRefresh(): {
  refreshing: boolean;
  onRefresh: () => void;
  /** The element, for a scroller that is not the one `Screen` owns. */
  refreshControl: React.ReactElement<RefreshControlProps>;
} {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }, []);

  return {
    refreshing,
    onRefresh: () => void onRefresh(),
    // El elemento se construye aqui y no en el que lo pinta, para que el color lo
    // sepa el hook y no cualquiera que monte un scroller.
    refreshControl: (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        tintColor={theme.colors.textSubtle}
      />
    ),
  };
}