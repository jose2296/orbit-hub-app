import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import type { Share } from "@orbit-hub/contracts";

import { PlaceShareSheet } from "@/components/shares/place-share-sheet";
import { SharedInboxRow } from "@/components/shares/shared-inbox-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useSession } from "@/hooks/use-session";
import { useShares } from "@/hooks/use-shares";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * What has been shared with this person and is not filed yet.
 *
 * **This screen exists because an email links to it.** The share notification points at
 * `/shared`, and before this route existed that link landed on *Page could not be found* —
 * on the screen of the person who had just been told they had been given something. The
 * inbox used to live only inside the drawer, and a drawer is a panel, not an address:
 * nothing in a mail can point at it.
 *
 * It is a screen and not a shortcut to opening the menu for two reasons. The mail arrives
 * on a phone that may have the app closed, and landing on the whole menu with the section
 * somewhere inside it is not the same as landing on the list. And the link is the durable
 * part: while `/shared` is a route, every mail sent from now on has somewhere to land, and
 * a broken one is a 404 in production that nobody is watching for.
 *
 * The rows are the drawer's, from `shared-inbox-row`, because two renderers of the same
 * row is how the drawer and the panel end up disagreeing about what a share is.
 *
 * **Not offline-first, and the API agrees on the reason:** a grant is a decision taken in
 * the server when somebody presses a button, so a cached copy can be wrong about whether
 * the person who shared it still means to. Filing the thing you were given works offline;
 * seeing what you have been given needs the network.
 */
export default function SharedWithMeScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const { status, user } = useSession();
  const { inbox, load, markSeen } = useShares();
  const [colocando, setColocando] = useState<Share | null>(null);

  useScreenTitle(t("drawer.sharedWithMe"));

  useFocusEffect(
    useCallback(() => {
      // Two things that belong to arriving here and not to opening the menu: the list
      // is this screen's own content, and the badge has to go to nothing the moment
      // the list is on screen — otherwise "2 sin mirar" is a number that survives the
      // thing it was counting, and going back says "1 sin mirar" about a list you
      // have just read.
      //
      // The stamp is per user, so it needs who is signed in, and the focus effect
      // runs before the session is restored on a cold open.
      void load();
      if (status === "authenticated") markSeen(user?.id ?? null);
    }, [load, markSeen, status, user?.id]),
  );

  return (
    <Screen width="reading">
      {inbox.length === 0 ? (
        <EmptyState
          title={t("drawer.sharedWithMe")}
          description={t("drawer.sharedWithMeEmpty")}
        />
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caption" tone="subtle">
            {t(pluralKey("drawer.sharedWithMeCount", inbox.length), {
              count: inbox.length,
            })}
          </AppText>
          {inbox.map((share) => (
            <SharedInboxRow
              key={share.id}
              share={share}
              onPress={() => setColocando(share)}
            />
          ))}
        </View>
      )}

      {/*
        The sheet that asks where it goes. Mounted only while there is something to
        place, so arriving here does not leave a hidden modal behind the screen.
      */}
      <PlaceShareSheet
        share={colocando}
        onClose={() => setColocando(null)}
        onPlaced={() => void load()}
      />
    </Screen>
  );
}