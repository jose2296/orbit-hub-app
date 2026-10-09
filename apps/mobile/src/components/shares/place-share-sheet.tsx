import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { Share } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { useShares } from "@/hooks/use-shares";
import { useSpacesTree } from "@/hooks/use-spaces-tree";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useTranslation } from "@/lib/i18n";
import { spacesYouCanFileInto } from "@/lib/shares/fileable-spaces";
import {
  EN_LA_RAIZ,
  cambiaDeEspacio,
  eligeCarpeta,
  entraEn,
  subeUnNivel,
  tieneCarpetasAdentro,
} from "@/lib/shares/where-it-goes";
import type { Recorrido } from "@/lib/shares/where-it-goes";
import { useTheme } from "@/theme";

/*
  ------------------------------------------------------------------
  EL ICONO DE CADA COSA QUE TE PUEDEN ENVIAR
  ------------------------------------------------------------------

  `Record<Share["nodeType"], string>` y no `Partial`, por lo que el typecheck hace
  el trabajo que antes hacia un guard: un `nodeType` nuevo en el enum rompe la
  compilacion hasta que alguien decida que icono lleva. Es la unica de las tablas
  de esta tarea que **si** conviene sea completa, porque aqui no hay "no aplica
  nunca": todo lo que se puede compartir, si se puede colocar, y el icono es
  informativo y no una decision de permisos.

  El de `collection` es el de una carpeta de enlaces y el de `bookmark` el contorno
  del enlace. Ninguno de los dos lo eligio el contrato: es una decision de esta
  pantalla y por eso vive aca y no se deriva de nada.
*/
const NODE_ICON: Record<Share["nodeType"], string> = {
  workspace: "grid-outline",
  folder: "folder-outline",
  list: "list-outline",
  list_item: "checkmark-circle-outline",
  note: "document-text-outline",
  collection: "albums-outline",
  bookmark: "bookmark-outline",
};

export interface PlaceShareSheetProps {
  /** The thing to file, or `null` when the panel is closed. */
  share: Share | null;
  onClose: () => void;
  onPlaced?: () => void;
}

/**
 * Where a received thing goes.
 *
 * The person who received it chooses, not the person who shared it, and that is
 * the whole reason this panel exists: somebody who is sent your shopping list
 * does not get to decide which of your spaces it lands in. The list appears in
 * your menu afterwards, next to your own, because that is what "in my space"
 * means once somebody has seen it.
 *
 * It is a link and not a copy, and this is the panel that says so out loud, once,
 * in the sentence right under the name. Somebody who does not know the
 * difference is the person who will be surprised in three months when the other
 * side deletes it and it goes from their phone too.
 */
export function PlaceShareSheet({
  share,
  onClose,
  onPlaced,
}: PlaceShareSheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { place } = useShares();
  const { syncNow } = useSyncStatus();
  const tree = useSpacesTree();

  const [saving, setSaving] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  /**
   * Where the list is looking and what it would file, as two separate things. The rules
   * live in `where-it-goes.ts` and are tested there; this is just the state.
   */
  const [recorrido, setRecorrido] = useState<Recorrido>(EN_LA_RAIZ);
  const [error, setError] = useState<string | null>(null);

  const spaces = useMemo(() => spacesYouCanFileInto(tree.spaces()), [tree]);

  if (!share) return null;

  const folders = workspaceId ? tree.foldersOf(workspaceId, recorrido.mirandoEn) : [];
  const padre = recorrido.mirandoEn ? tree.parentOf(recorrido.mirandoEn) : null;

  /*
   * Filing is a decision taken in the server, so **it only shows up on the next pull**.
   * Without the pull the thing was filed, left the inbox, and never appeared: the
   * panel closed, the row was gone, and the space the person had just put it in was
   * exactly as empty as it was before. Which reads as the button not working, and it is
   * the one flow in the app where that is true — every other write goes through the
   * queue and lands locally first, and this one cannot, by design.
   */
  const confirmar = async () => {
    if (!workspaceId) return;
    /*
      Y `saving` sigue haciendo falta aunque el boton ya no lo lea.
      El boton apagado del pie se encarga de que no se pulse dos veces con el dedo,
      pero con teclado o con un lector de pantalla no hay dedo que lo impida, y dos
      invitations con el mismo enlace es una invitacion repetida. El flag se
      comprueba **en la accion**, que es donde un segundo intento se puede parar sin
      haber escrito nada.
    */
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await place({ shareId: share.id, workspaceId, folderId: recorrido.elige });
      // The wait happens before the panel closes, so the person is not left looking at
      // a space that has not changed yet with no sign that anything is happening.
      await syncNow();
      onClose();
      onPlaced?.();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : t("errors.unknown"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t("place.title")}
      subtitle={share.title}
      scrollable={false}
      /* El Guardar es el del pie. El Cancelar de abajo se va: era una segunda
         puerta de salida, y la unica que no hacia la pregunta. */
      onSave={() => void confirmar()}
      saveDisabledReason={!workspaceId ? t("place.whereNeeded") : undefined}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Ionicons
            name="people-outline"
            size={16}
            color={theme.colors.textMuted}
            style={{ marginTop: 2 }}
          />
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            {t("place.isALink")}
          </AppText>
        </View>

        {/*
         * The `testID` is on the *list of spaces*, not on the sheet, and for a reason
         * that cost an hour: the drawer stays open behind this panel and it lists the
         * spaces too, including the sender's. A check that reads the whole page finds
         * the sender's space either way and cannot tell a correct panel from a broken
         * one.
         */}
        <View testID="place-spaces" style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t("place.chooseSpace")}
          </AppText>
          {spaces.length === 0 ? (
            /*
             * Said out loud, because the alternative is a panel with nothing in it and
             * a button that never lights up.
             *
             * And it names the way out rather than just the problem: this is the state
             * of somebody who has just been sent their first thing and has not made a
             * space yet, which is the *first* thing that happens to a new person.
             *
             * The button goes to the screen with the `+` on it instead of opening a
             * second sheet on top of this one. Two sheets stacked is the kind of thing
             * that works in a browser and behaves differently on a phone, and this one
             * is a dead end either way — so the honest version is a hop to a screen
             * that is known to work.
             */
            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="caption" tone="muted">
                {t("place.noSpaces")}
              </AppText>
              <Button
                label={t("place.createSpace")}
                variant="secondary"
                onPress={() => {
                  onClose();
                  router.push("/workspaces");
                }}
              />
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled>
              <View style={{ gap: 2 }}>
                {spaces.map((space) => (
                  <Pick
                    key={space.id}
                    icon="grid-outline"
                    label={space.name}
                    selected={space.id === workspaceId}
                    onPress={() => {
                      setWorkspaceId(space.id);
                      setRecorrido(cambiaDeEspacio());
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          )}
        </View>

        {workspaceId ? (
          <View style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="subtle">
              {t("place.chooseFolder")}
            </AppText>
            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
              <View style={{ gap: 2 }}>
                {padre ? (
                  /*
                   * Back out. Without it the list is a corridor: you can go three
                   * folders deep and the only way to the root is to close the panel and
                   * start again, and the only way to the folder you wanted is to pick
                   * every folder on the way down.
                   */
                  <Pick
                    icon="arrow-up-outline"
                    label={t("place.upOneLevel")}
                    selected={false}
                    onPress={() =>
                      setRecorrido((actual) =>
                        subeUnNivel(actual, (id) => tree.parentOf(id)),
                      )
                    }
                  />
                ) : null}
                {/* The root of the space is a place, not "nowhere": a thing at the
                    top of a space is filed, and the only reason to have this
                    button is to undo a folder that was picked by mistake. */}
                <Pick
                  icon="ellipsis-horizontal-circle-outline"
                  label={t("place.rootOfSpace")}
                  selected={recorrido.mirandoEn === null && recorrido.elige === null}
                  onPress={() => setRecorrido(EN_LA_RAIZ)}
                />
                {folders.map((folder) => (
                  <Pick
                    key={folder.id}
                    icon="folder-outline"
                    label={folder.name}
                    selected={folder.id === recorrido.elige}
                    onPress={() =>
                      setRecorrido((actual) => eligeCarpeta(actual, folder.id))
                    }
                    onOpen={
                      tieneCarpetasAdentro(folder, (ws, parent) =>
                        tree.foldersOf(ws, parent),
                      )
                        ? () =>
                            setRecorrido((actual) => entraEn(actual, folder.id))
                        : undefined
                    }
                    openLabel={t("place.lookInside", { name: folder.name })}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {error ? (
          <AppText variant="caption" style={{ color: theme.colors.danger }}>
            {error}
          </AppText>
        ) : null}

        {/*
          Y aqui ya no hay botones: el de confirmar esta en el pie y el Cancelar
          se ha ido. Era la segunda forma de cerrar de esta hoja, y la unica que
          no preguntaba antes de perder la eleccion.
        */}
      </View>
    </Sheet>
  );
}

/**
 * One row: pick it, and — when there is something inside — look inside it.
 *
 * **Two sibling pressables, not a button inside a button.** The first version nested the
 * chevron `Pressable` inside the row's, and on web that renders `<button><button>`, which
 * is invalid HTML: the browser re-parents the inner one, React's hydration disagrees
 * about the tree it just built, and the row it lands in is not the row the press handler
 * belongs to. It looked fine in the snapshot and was broken in the only browser anybody
 * can check.
 *
 * A `View` for the layout and two presses side by side inside it is also the only version
 * where the chevron does what it says: nesting meant a tap near the arrow could select
 * the folder it was only meant to open.
 */
function Pick({
  icon,
  label,
  selected,
  onPress,
  onOpen,
  openLabel,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Present only when there is something inside, so the affordance is not a dead end. */
  onOpen?: () => void;
  /** Spoken by the "look inside" press. Passed in, not translated here. */
  openLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: theme.radius.md,
        backgroundColor: selected ? theme.colors.accentSoft : "transparent",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 38,
          paddingHorizontal: theme.spacing.sm,
          borderRadius: theme.radius.md,
          backgroundColor:
            selected || !pressed ? "transparent" : theme.colors.surfaceMuted,
        })}
      >
        <Ionicons
          name={icon as never}
          size={16}
          color={selected ? theme.colors.accent : theme.colors.textMuted}
        />
        <AppText
          variant="body"
          numberOfLines={1}
          style={{ flex: 1, color: selected ? theme.colors.accent : undefined }}
        >
          {label}
        </AppText>
      </Pressable>
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          // Deliberately not the folder's name: the two presses are different actions and
          // a screen reader that hears the same label twice has no way to choose.
          accessibilityLabel={openLabel ?? label}
          hitSlop={8}
          onPress={onOpen}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: 4,
            borderRadius: theme.radius.sm,
            backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
          })}
        >
          <Ionicons
            name="chevron-forward-outline"
            size={16}
            color={theme.colors.textMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export { NODE_ICON };
