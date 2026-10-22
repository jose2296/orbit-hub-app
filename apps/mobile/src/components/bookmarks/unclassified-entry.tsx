import { useRouter } from "expo-router";
import { View } from "react-native";

import { ListRow } from "@/components/ui/list-row";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { pluralKey, useTranslation } from "@/lib/i18n";

export interface UnclassifiedEntryProps {
  workspaceId: string;
  /** La carpeta que se mira, o `null` en la raiz del espacio. */
  folderId: string | null;
}

/**
 * Los enlaces sin clasificar **de este sitio**, a un toque.
 *
 * El inbox del drawer cruza todos los espacios; esto es el mismo filtro acotado al
 * espacio (y a la carpeta) que se esta mirando. No se pinta si no hay ninguno: un
 * inbox vacio no es una puerta.
 */
export function UnclassifiedEntry({ workspaceId, folderId }: UnclassifiedEntryProps) {
  const router = useRouter();
  const t = useTranslation();
  const { bookmarks } = useBookmarks({ workspaceId, folderId, collectionId: "unclassified" });

  if (bookmarks.length === 0) return null;

  return (
    <View testID="workspace-unclassified-entry">
    <ListRow
      title={t("place.unclassified")}
      subtitle={t(pluralKey("bookmarks.unclassifiedCount", bookmarks.length), {
        count: bookmarks.length,
      })}
      icon="file-tray-outline"
      chevron
      onPress={() =>
        router.push({
          pathname: "/(app)/bookmarks",
          params: {
            workspaceId,
            ...(folderId ? { folderId } : {}),
            collectionId: "unclassified",
          },
        })
      }
    />
    </View>
  );
}
