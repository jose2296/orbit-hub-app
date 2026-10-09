import { View } from "react-native";

import { SharedBadge } from "@/components/shares/shared-badge";
import { useTheme } from "@/theme";
import { useTranslation } from "@/lib/i18n";
import { AppText } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

import { nodeTypeDe } from "@/lib/menus/registry";
import type { MenuContext } from "@/lib/menus/registry";
import { useAlcanceDeAcceso } from "@/lib/menus/alcance";

export interface AccessPageProps {
  ctx: MenuContext;
}

/**
 * Los kinds cuyo alcance **no se puede preguntar todavia**.
 *
 * `shareNodeTypeSchema` (`packages/contracts/src/workspace.ts:943`) es
 * `['workspace', 'folder', 'list', 'list_item', 'note']`. Una coleccion y un
 * enlace no estan, y `GET /shares/:nodeType/:id/reach` no los entiende:
 * mandarlos seria inventar un `nodeType` y pintar el 400 del servidor como si
 * fuera una respuesta.
 *
 * Lo que **si** alcanza en esos dos es la insignia: `SharedBadge` solo pide
 * `shared` y `role`, y las cinco entidades los traen por `nodeAccessSchema`. O
 * sea que la pregunta de si es tuyo se contesta completa, y la de con quien mas
 * lo tenes todavia no tiene de donde salir. Se dice, no se omite.
 */
/*
  ------------------------------------------------------------------
  POR QUE NO HAY UNA LISTA DE KINDS ACA
  ------------------------------------------------------------------

  Habia una: `NODE_TYPE`, un `Partial<Record<MenuKind, ShareNodeType>>` con tres
  claves. Y era peor que la de `SharePage`, no igual de mala: el `Partial` **no
  puede decir "no aplica nunca"**, solo "no se", asi que un kind ausente era
  indistinguible de uno que se olvido agregar. Con la T10 el enum del contrato
  admite los cinco y la pregunta ya tiene respuesta para todos, asi que la linea
  `share.reachNotYet` —que solo decia "todavia no se puede saber"— queda sin uso y
  se borro de los dos diccionarios.

  Y lo que se puso en su lugar no es otra lista sino **la misma funcion que usa el
  registro** para decidir si ofrece la fila de compartir: `nodeTypeDe`. Dos
  pantallas, una decision, y ninguna copia del enum del contrato en ningun archivo
  de esta pantalla.

  La insignia de arriba —`SharedBadge`, con `shared` y `role`— no cambio nunca y no
  depende de esto: las cinco entidades traen los dos campos por `nodeAccessSchema`.
*/

export function AccessPage({ ctx }: AccessPageProps) {
  const theme = useTheme();
  const t = useTranslation();

  const nodeType = nodeTypeDe(ctx.kind);
  const alcance = useAlcanceDeAcceso(
    nodeType ? { nodeType, nodeId: ctx.entity.id } : null,
  );

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/*
        La primera mitad, y la que funciona en las cinco entidades: de quien es
        y que permiso tiene. Sin ella, una cosa compartida contigo y una tuya se
        ven iguales — que es exactamente lo que `SharedBadge` existe para que no
        pase.
      */}
      <SharedBadge shared={ctx.entity.shared} role={ctx.entity.role} />

      {/*
        La segunda mitad, cuando se puede preguntar. El corte es por `nodeType`,
        o sea por lo que el contrato admite, y **no** por si la peticion vino
        vacia: `nodeType` no cambia con el resultado.
      */}
      {nodeType ? (
        alcance.estado === "fallo" ? (
          <View style={{ gap: theme.spacing.sm }}>
            {/*
              El error se ve, y no como una lista vacia. "No he podido preguntar"
              y "no hay nadie mas" son dos frases distintas y solo una de ellas es
              cierta aca. Y lo que se ofrece es volver a intentarlo, no cerrar la
              pagina y perder la pregunta: `reintentar` pega otra vez al mismo
              endpoint, que es la regla de reintento de la hoja.
            */}
            <AppText variant="body">{t("share.reachFailed")}</AppText>
            <Button
              label={t("common.retry")}
              variant="secondary"
              size="sm"
              fullWidth
              onPress={alcance.reintentar}
            />
          </View>
        ) : alcance.estado === "listo" ? (
          <View style={{ gap: theme.spacing.sm }}>
            {/*
              Recien aca se puede decir un numero, y solo aca. Antes estaban los
              dos casos que no son una respuesta: la espera y el fallo.
            */}
            <AppText variant="caption" tone="muted">
              {t("share.reachTitle")}
            </AppText>
            <AppText variant="body">
              {alcance.datos?.count === 1
                ? t("share.reachOne")
                : t("share.reachOther", { count: alcance.datos?.count ?? 0 })}
            </AppText>
            {alcance.datos && alcance.datos.count > 0 ? (
              <>
                <AppText variant="caption" tone="muted">
                  {t("share.reachPeople")}
                </AppText>
                {alcance.datos.people.map((persona) => (
                  <AppText key={persona.userId} variant="body">
                    {persona.email}
                  </AppText>
                ))}
              </>
            ) : null}
          </View>
        ) : (
          <AppText variant="body">{t("common.loading")}</AppText>
        )
      ) : (
        /*
          La rama de un kind que el contrato no admite. Con los cinco de hoy no se
          llega, y **no es decoracion**: es lo que hace que `nodeTypeDe` pueda
          devolver `null` sin que el typecheck lo llame mentira.

          Lo que se borro de aca es la frase. Decir "todavia no se puede saber" es
          una afirmacion sobre el mundo —falta informacion— y con el enum completo
          es mentira: la informacion esta ahi y no se esta pidiendo. Una pagina que
          dice "no se" cuando si se, teaches a la gente a no creerse el "si".

          Asi que en vez de una frase que no aplica a nadie, esta el silencio de un
          caso que el registro no deja llegar. Y si un dia un kind vuelve a quedarse
          fuera del enum, lo que sale es la insignia de arriba y nada mas, que es
          exactamente lo que se sabia: de quien es y si podes cambiarlo.
        */
        null
      )}
    </View>
  );
}

