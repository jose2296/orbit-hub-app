import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import type { Person } from "@orbit-hub/contracts";

import { AppText } from "@/components/ui/text";
import { filterPeople, usePeople } from "@/hooks/use-people";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface PersonPickerProps {
  /** What has been typed so far, so the list can filter against it. */
  query: string;
  /** Chosen already, and drawn as chosen. Null means "nobody yet". */
  selected: Person | null;
  onPick: (person: Person | null) => void;
  /**
   * Who already has the thing being shared, so their row can say so and refuse.
   *
   * From `useShareReach`, which is `null` both while asking and when the request
   * failed. Both mean the same thing here: say nothing. A list that greys people
   * out on the strength of a request that came back empty is worse than one that
   * lets somebody press a button the server will refuse a moment later.
   */
  alreadyHaveIds?: readonly string[];
  /** A fullscreen picker inside a sheet does not need its own heading rule. */
  compact?: boolean;
}

/**
 * The people you already know, as a list you can tap.
 *
 * This is not a search over everybody in the app, and there is no version of it that
 * is. It only ever lists people you have already shared with or who share a space
 * with you, which is what lets it show a name and an address without leaking
 * anything: you already knew both. See ADR 0032.
 *
 * **The free-text field above it is not a fallback, it is the other half.** The
 * directory cannot know the neighbour who has never opened the app, and a picker
 * that only offers acquaintances is a picker that does not let you share with half
 * the world. So typing an address that matches nobody does exactly what it did
 * before this existed.
 */
export function PersonPicker({
  query,
  selected,
  onPick,
  alreadyHaveIds = [],
  compact = false,
}: PersonPickerProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { people, isLoading, error, load } = usePeople();

  // Asked when the panel opens, and not on mount of the app: this hook is used from
  // inside sheets that are mounted from the first frame of the drawer, and a
  // request with no session yet is a 401 in the log of every menu ever drawn.
  useEffect(() => {
    void load();
  }, [load]);

  const yaLoTienen = new Set(alreadyHaveIds);
  const coincidencias = filterPeople(people, query);
  // The chosen one stays in the list even when the query no longer matches, so
  // tapping somebody and then typing does not make the row you just tapped
  // disappear and leave the share with a person nobody can see.
  const lista =
    selected && !coincidencias.some((p) => p.user.id === selected.user.id)
      ? [selected, ...coincidencias]
      : coincidencias;

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText variant="caption" tone="subtle">
        {t("share.peopleYouKnow")}
      </AppText>

      {isLoading ? (
        <View style={{ paddingVertical: theme.spacing.md, alignItems: "center" }}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : error ? (
        // A failure here is not a wall: the address field above still works, and
        // that is exactly how the app shared things before this list existed.
        <AppText variant="caption" tone="subtle">
          {t("people.empty")}
        </AppText>
      ) : lista.length === 0 ? (
        <AppText variant="caption" tone="subtle">
          {t("people.empty")}
        </AppText>
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {lista.map((person) => {
            const elegido = selected?.user.id === person.user.id;
            const yaLaTiene = yaLoTienen.has(person.user.id);
            const nombre = person.user.displayName || person.user.email;

            return (
              <Pressable
                key={person.user.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: elegido, disabled: yaLaTiene }}
                accessibilityLabel={nombre}
                accessibilityHint={
                  yaLaTiene ? t("share.alreadyHasItHint") : undefined
                }
                disabled={yaLaTiene}
                onPress={() => onPick(elegido ? null : person)}
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: elegido
                      ? theme.colors.accent
                      : theme.colors.border,
                    backgroundColor: elegido
                      ? theme.colors.accentSoft
                      : pressed
                        ? theme.colors.surfaceMuted
                        : "transparent",
                    // Dimmed rather than hidden: they are still somebody you know,
                    // they just cannot be given this particular thing twice.
                    opacity: yaLaTiene ? 0.45 : 1,
                  },
                ]}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: theme.radius.sm,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.surfaceMuted,
                  }}
                >
                  <AppText variant="caption" tone="subtle">
                    {nombre.slice(0, 1).toUpperCase()}
                  </AppText>
                </View>

                <View style={{ flex: 1, gap: 1 }}>
                  <AppText variant="body" numberOfLines={1}>
                    {nombre}
                  </AppText>
                  <AppText variant="caption" tone="subtle" numberOfLines={1}>
                    {person.user.email}
                  </AppText>
                </View>

                {yaLaTiene ? (
                  <AppText variant="caption" tone="subtle">
                    {t("share.alreadyHasIt")}
                  </AppText>
                ) : elegido ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={theme.colors.accent}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {!compact && people.length > 0 ? (
        <AppText variant="caption" tone="subtle" style={{ marginTop: theme.spacing.xs }}>
          {t("share.peopleYouKnowHint")}
        </AppText>
      ) : null}
    </View>
  );
}
