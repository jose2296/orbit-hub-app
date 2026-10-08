import type { ShareNodeType, ShareReach } from "@orbit-hub/contracts";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";

/** Lo que la pregunta tiro, y por eso se la muestra al usuario. */
export type EstadoDelAlcance = "cargando" | "fallo" | "listo";

export interface Alcance {
  estado: EstadoDelAlcance;
  /** Solo con estado "listo". En cualquier otro caso es `null`. */
  datos: ShareReach | null;
  reintentar: () => void;
}

/**
 * "A cuantas personas afecta esto", y **sin que `null` signifique dos cosas**.
 *
 * ------------------------------------------------------------------
 * POR QUE NO SE USA `useShareReach`
 * ------------------------------------------------------------------
 *
 * `hooks/use-saes.ts` lo devuelve `null` en dos casos distintos: cuando no hay
 * target (`:170`) y cuando el request fallo (`:183`). La persona que lee `null`
 * no puede saber si es "no he preguntado", "no he sabido" o "no hay nadie".
 *
 * La ya dijo en prosa, en `person-picker.tsx:21`: *"which is `null` both while
 * asking and when the request [fails]"*. Ese hook esta bien para el formulario
 * de compartir, donde lo unico que se hace con el numero es mostrarlo si esta y
 * no mostrarlo si no. Para una pagina que responde **"quien mas tiene esto"**
 * no alcanza, porque el fallo pintado como vacio le dice a alguien que es el
 * dueno de algo que no es suyo. Ese es el peor resultado posible, y por eso
 * existe este hook en vez de reutilizar el otro.
 *
 * Y no se cambio `useShareReach` para que `null` signifique una sola cosa
 * porque tiene un consumidor vivo (`share-node-sheet.tsx:74`) y hoy le alcanza
 * con dos estados.
 *
 * ------------------------------------------------------------------
 * POR QUE EL VACIO ES UN DATO Y NO UN NULL
 * ------------------------------------------------------------------
 *
 * `shareReachSchema` (`workspace.ts:1032`) tiene `count: z.number().int().
 * nonnegative()`. El cero es una respuesta valida y del servidor, o sea que
 * **"no hay nadie mas" es `estado === "listo"` con `count === 0`**, no un
 * `null`. Confundirlos es el mismo error de arranque.
 */
export function useAlcanceDeAcceso(
  target: { nodeType: ShareNodeType; nodeId: string } | null,
): Alcance {
  const [estado, setEstado] = useState<EstadoDelAlcance>("cargando");
  const [datos, setDatos] = useState<ShareReach | null>(null);
  const [golpe, setGolpe] = useState(0);

  const reintentar = useCallback(() => setGolpe((n) => n + 1), []);

  useEffect(() => {
    if (!target) {
      setEstado("cargando");
      setDatos(null);
      return;
    }

    let cancelado = false;
    setEstado("cargando");

    api
      .get<ShareReach>(`/shares/${target.nodeType}/${target.nodeId}/reach`)
      .then((respuesta) => {
        if (cancelado) return;
        setDatos(respuesta);
        setEstado("listo");
      })
      .catch(() => {
        if (cancelado) return;
        setDatos(null);
        setEstado("fallo");
      });

    return () => {
      cancelado = true;
    };
  }, [target?.nodeType, target?.nodeId, golpe]);

  return { estado, datos, reintentar };
}
