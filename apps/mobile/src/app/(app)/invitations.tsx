import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { Invitation } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useMyInvitations } from "@/hooks/use-my-invitations";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";
import { usePendingInvitations } from "@/lib/workspaces/pending-invitations";

/**
 * The invitations waiting for an answer.
 *
 * **This is the door the mail used to be.** "Ana te ha invitado a Casa" arriving by
 * mail is good — mail is where somebody hears about it without opening an app. But the
 * mail was also the only way to answer, which makes the notification load-bearing: lose
 * the mail, or search for it, or have it land in a folder, and the invitation is
 * invisible and the space never happens. The mail now says it exists; this is where the
 * decision is made.
 *
 * **One invitation per row, with both answers on the row.** Not a tap to open and then
 * a choice: the two answers are "sí" and "no", they are both one tap, and a screen that
 * can only be answered by going somewhere else is the same trap one level down.
 *
 * The role is written out in words on the row, in the same phrasing the mail and the
 * link use, because "aceptar" without saying what you are accepting is how somebody
 * ends up in a space as a viewer and finds out later.
 *
 * Not offline-first, and the endpoint agrees on why: an invitation is somebody else's
 * decision, revocable while your phone is in a drawer, so a cached copy would go on
 * offering something that no longer exists.
 */
export default function MyInvitationsScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { items, isLoading, error, pendingToken, load, accept, decline } = useMyInvitations();
  const [navegando, setNavegando] = useState<string | null>(null);

  /**
   * The badge in the menu, asked to forget its count the moment one of these is
   * answered. Without it, going back to the menu shows "2 invitaciones" over a list
   * that now has one, and the badge is the number somebody trusts to be true.
   */
  const { refresh: refreshBadge } = usePendingInvitations(false);

  useScreenTitle(t("myInvitations.title"));

  const onAccept = useCallback(
    async (invitacion: Invitation) => {
      setNavegando(invitacion.token);
      const espacio = await accept(invitacion.token);
      setNavegando(null);
      if (espacio) void refreshBadge();
      // Straight into the space that was just offered: the answer was yes, and the
      // next thing to do with a space you just joined is be in it.
      if (espacio) router.replace(`/(app)/workspace/${espacio.id}`);
    },
    [accept, router],
  );

  return (
    <Screen width="reading">
      {items.length === 0 ? (
        <EmptyState
          title={t("myInvitations.emptyTitle")}
          description={t("myInvitations.emptyBody")}
          /*
            The second line, and the reason it exists.
            *
            * With the mail as the only door, being in the wrong account produced an
            * explicit answer: the link said "this invitation is for another address".
            * With the door in the app, the same mistake produces **nothing** — an empty
            * list reads as "nobody invited you", and the person who was invited goes
            * looking for a mail that is sitting in another account.
            *
            * So the empty state names the possibility. It is the only place the app can
            * say it, because this screen is the only place where it is true.
            */
          action={
            <AppText variant="caption" tone="subtle">
              {t("myInvitations.emptyWrongAccount")}
            </AppText>
          }
        />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="caption" tone="subtle">
            {t(pluralKey("myInvitations.count", items.length), {
              count: items.length,
            })}
          </AppText>

          {error ? (
            <AppText variant="caption" tone="danger">
              {error}
            </AppText>
          ) : null}

          {items.map((invitacion) => (
            <InvitationCard
              key={invitacion.id}
              invitation={invitacion}
              busy={pendingToken === invitacion.token}
              navigating={navegando === invitacion.token}
              onAccept={() => void onAccept(invitacion)}
              onDecline={() => void decline(invitacion.token).then(refreshBadge)}
            />
          ))}

          {isLoading ? null : (
            <Button
              variant="ghost"
              label={t("common.retry")}
              onPress={() => void load()}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

/**
 * One invitation, with both answers.
 *
 * Its own component so the busy state is one piece of state per invitation: with the
 * busy flag on the screen, accepting one invitation would freeze the buttons on all
 * the others, which is a thing a list of four invitations does constantly.
 */
function InvitationCard({
  invitation,
  busy,
  navigating,
  onAccept,
  onDecline,
}: {
  invitation: Invitation;
  busy: boolean;
  navigating: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useTranslation();
  const puedeEditar = invitation.role === "editor";

  return (
    <Card>
      <AppText variant="title">{invitation.workspaceName}</AppText>

      <AppText variant="callout" tone="subtle">
        {t("invite.from", {
          name: invitation.invitedBy.displayName,
        })}
      </AppText>

      {/* The role in words, on the row, before the buttons: what you are accepting is
          part of the answer and not a detail that comes after it. */}
      <AppText variant="caption" tone="subtle">
        {t(puedeEditar ? "invite.joinAsEditor" : "invite.joinAsViewer")}
      </AppText>

      <View style={styles.acciones}>
        <Button
          label={t("invite.join")}
          onPress={onAccept}
          loading={busy || navigating}
          style={styles.boton}
        />
        <Button
          variant="ghost"
          label={t("invite.decline")}
          onPress={onDecline}
          disabled={busy || navigating}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  acciones: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  boton: {
    flexShrink: 1,
  },
});