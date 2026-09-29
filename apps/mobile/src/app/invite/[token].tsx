import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { AppText } from "@/components/ui/text";
import { useInvitationPreview } from "@/hooks/use-members";
import { useSession } from "@/hooks/use-session";
import { useScreenTitle } from "@/hooks/use-screen-title";
import { useTranslation } from "@/lib/i18n";
import { rolePromiseKey } from "@/lib/workspace/sharing";
import { cardColors, colorOf } from "@/lib/workspace/color";
import { useTheme } from "@/theme";

/**
 * What an invitation says, and the one button that acts on it.
 *
 * Outside `(app)` on purpose: the whole point of an invitation is that the
 * person who got it is not signed in yet, and a route behind the auth guard
 * would send them to the welcome screen and lose the link. So it lives at the
 * top level, asks for a session before it can act, and comes back to the same
 * token afterwards.
 *
 * The space is shown in its own colour before anybody presses anything, because
 * "you have been invited to Casa" and "you have been invited to a stranger's
 * password manager" should not look the same.
 */
export default function InvitationScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { status } = useSession();
  // Only asked for once there is somebody to ask about: the preview says
  // whether the link is for the person reading it, and that is a question about
  // a session that has to exist first.
  const { preview, isLoading, error, accept, decline } = useInvitationPreview(
    typeof token === "string" ? token : null,
    status === "authenticated",
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<"joined" | "declined" | null>(null);

  useScreenTitle(t("invite.title"));

  const onAccept = async () => {
    setBusy("accept");
    try {
      await accept();
      setDone("joined");
    } catch {
      setBusy(null);
    }
  };

  const onDecline = async () => {
    setBusy("decline");
    try {
      await decline();
      setDone("declined");
    } catch {
      setBusy(null);
    }
  };

  if (status === "loading" || (status === "authenticated" && isLoading)) {
    return (
      <Screen>
        <View
          style={{ paddingVertical: theme.spacing.xxl, alignItems: "center" }}
        >
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      </Screen>
    );
  }

  // Signed out: the link is still here, so signing in and coming back lands on
  // the invitation and not on the home screen.
  if (status === "anonymous") {
    return (
      <Screen>
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <AppText variant="body">{t("invite.signInFirst")}</AppText>
          <Button
            label={t("invite.signIn")}
            fullWidth
            onPress={() =>
              router.replace({
                pathname: "/(auth)/sign-in",
                params: { next: `/invite/${token}` },
              })
            }
          />
        </Card>
      </Screen>
    );
  }

  if (error || !preview) {
    return (
      <Screen>
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <View style={[styles.row, { gap: theme.spacing.sm }]}>
            <Ionicons
              name="link-outline"
              size={20}
              color={theme.colors.textMuted}
            />
            <AppText variant="heading">{t("invite.badLink")}</AppText>
          </View>
          <AppText variant="body" tone="muted">
            {t("invite.badLinkBody")}
          </AppText>
          <Button
            label={t("common.back")}
            variant="secondary"
            fullWidth
            onPress={() => router.replace("/(app)")}
          />
        </Card>
      </Screen>
    );
  }

  const colors = cardColors(colorOf(preview.workspace.color));

  if (done === "declined") {
    return (
      <Screen>
        <Card variant="outlined" style={{ gap: theme.spacing.md }}>
          <AppText variant="body">{t("invite.declined")}</AppText>
          <Button
            label={t("common.back")}
            variant="secondary"
            fullWidth
            onPress={() => router.replace("/(app)")}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: theme.spacing.md }}>
        {/* The space, in its own colour. The person deciding whether to press
            the button gets to see what they are being let into first. */}
        <View
          style={[
            styles.space,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <AppText variant="title">{preview.workspace.emoji ?? "•"}</AppText>
          <AppText
            variant="title"
            numberOfLines={2}
            style={{ color: colors.foreground }}
          >
            {preview.workspace.name}
          </AppText>
        </View>

        <AppText variant="body">
          {t("invite.from", { name: preview.invitedBy })}
        </AppText>
        <AppText variant="caption" tone="muted">
          {t(rolePromiseKey(preview.role))}
        </AppText>

        {preview.invitedEmail && !preview.isForYou ? (
          <Card variant="outlined" style={{ gap: theme.spacing.xs }}>
            <AppText variant="caption" tone="danger">
              {t("invite.notForYou", { email: preview.invitedEmail })}
            </AppText>
          </Card>
        ) : null}

        {preview.alreadyMember || done === "joined" ? (
          <>
            <AppText variant="body">{t("invite.alreadyIn")}</AppText>
            <Button
              label={t("common.openSpace")}
              fullWidth
              onPress={() =>
                router.replace(`/(app)/workspace/${preview.workspace.id}`)
              }
            />
          </>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={t("invite.join")}
              icon="enter-outline"
              fullWidth
              loading={busy === "accept"}
              disabled={busy !== null || !preview.isForYou}
              onPress={() => void onAccept()}
            />
            <Button
              label={t("invite.decline")}
              variant="ghost"
              fullWidth
              loading={busy === "decline"}
              disabled={busy !== null}
              onPress={() => void onDecline()}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  space: {
    gap: 8,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
  },
});
