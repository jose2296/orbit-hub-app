import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { apiRequest } from "@/lib/api";
import { useTheme } from "@/theme";

/**
 * Si algo esta compartido, y por quien, al lado del titulo.
 *
 * Son **dos** iconos y no uno porque son dos hechos distintos, y quien mira
 * quiere saber cosas distintas de cada uno:
 *
 * - **Te lo compartieron.** Estas aqui porque alguien te dio el enlace. Es la
 *   informacion de *por que* estas mirando esto, y la que un `role` no puede
 *   decir: un `viewer` en un espacio compartido y alguien invitado a un espacio
 *   propio tienen el mismo rol y son situaciones opuestas.
 * - **Tu lo compartiste.** Has dado este enlace a otra persona. Es un aviso de
 *   que hay alguien mas mirando, y es informacion que **solo existe en el
 *   servidor**: cambia cada vez que alguien comparte, asi que no viaja en el sync
 *   —esta escrito en el contrato, con su motivo— y hay que preguntar.
 *
 * Y **ninguno de los dos pinta nada** cuando no hay nada que pintar. Un icono de
 * compartir en todo es un icono que no dice nada, y ademas empuja el titulo.
 */
export interface CompartirBadgeProps {
  /** The node, or `null` when there is nothing to ask about. */
  node: { nodeType: "workspace" | "folder" | "list" | "note"; id: string } | null;
  /** `true` when somebody handed it to you: the `shared` flag on the entity. */
  compartidoConmigo?: boolean;
  /** Opens the share sheet. */
  onShare?: () => void;
}

export function CompartirBadge({
  node,
  compartidoConmigo = false,
  onShare,
}: CompartirBadgeProps) {
  const theme = useTheme();
  const [cuantos, setCuantos] = useState<number | null>(null);

  const id = node?.id;
  const tipo = node?.nodeType;

  useEffect(() => {
    if (!id || !tipo) {
      setCuantos(null);
      return;
    }
    let vivo = true;
    // Se pregunta **una vez al montar** y no en cada render. La respuesta cambia
    // cada vez que alguien comparte, y una cabecera que se enciende y apaga el
    // icono cada vez que el foco vuelve es peor que no dibujar el segundo.
    apiRequest<unknown>(`/shares/${tipo}/${id}/reach`)
      .then((body) => {
        const lista = (body as { data?: unknown })?.data ?? body;
        if (vivo && Array.isArray(lista)) setCuantos(lista.length);
      })
      .catch(() => {
        // Sin respuesta no se dibuja. Es una insignia, no un dato: si no se puede
        // saber, no hay nada que avisar — y un icono que sale a medias miente mas
        // que uno que no sale.
        if (vivo) setCuantos(null);
      });
    return () => {
      vivo = false;
    };
  }, [id, tipo]);

  const loCompartiYo = (cuantos ?? 0) > 0;
  if (!compartidoConmigo && !loCompartiYo) return null;

  return (
    <View style={styles.fila}>
      {compartidoConmigo ? (
        <Pressable
          testID="compartido-conmigo"
          accessibilityRole="imagebutton"
          accessibilityLabel={onShare ? "Te lo han compartido. Compartir" : "Te lo han compartido"}
          hitSlop={8}
          onPress={onShare}
        >
          <Ionicons name="link" size={15} color={theme.colors.textSubtle} />
        </Pressable>
      ) : null}
      {loCompartiYo ? (
        <Pressable
          testID="compartido-por-mi"
          accessibilityRole="imagebutton"
          accessibilityLabel={`Lo has compartido con ${cuantos} ${
            cuantos === 1 ? "persona" : "personas"
          }${onShare ? ". Compartir" : ""}`}
          hitSlop={8}
          onPress={onShare}
        >
          <Ionicons name="people-outline" size={15} color={theme.colors.textSubtle} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fila: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
});