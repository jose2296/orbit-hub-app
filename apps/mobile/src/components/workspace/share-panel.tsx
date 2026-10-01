import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import type { Invitation, Person, WorkspaceMember } from "@orbit-hub/contracts";

import { PersonPicker } from "@/components/people/person-picker";
import { Button } from "@/components/ui/button";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useMembers } from "@/hooks/use-members";
import { useSession } from "@/hooks/use-session";
import { inviteLinkFor, roleLabelKey } from "@/lib/workspace/sharing";
import { shareLink } from "@/lib/workspace/share-link";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface SharePanelProps {
  workspaceId: string | null;
  /** The space's name, so the panel does not wait for the list to load. */
  workspaceName: string;
  /** Only an owner can invite; everybody else gets a read-only list. */
  isOwner: boolean;
  /** Goes back to the page that opened this one. */
  onBack: () => void;
}

type Page = "people" | "invite" | "link";

/**
 * Who is in this space, and how somebody else gets in.
 *
 * A page of the space's menu and not a panel of its own. A panel on top of a
 * panel is two backdrops over one screen, and a tap that reaches the wrong one
 * closes what is underneath instead of doing what was asked.
 *
 * The order is the order the questions come in: who is here, then let somebody
 * in. The two ways of letting somebody in are on purpose, because they are two
 * different acts: an email finds the person by itself, and a link is for when
 * you are talking to them right now and an address is more ceremony than the
 * moment needs.
 */
export function SharePanel({
  workspaceId,
  workspaceName,
  isOwner,
  onBack,
}: SharePanelProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { user } = useSession();
  const {
    members,
    invitations,
    isLoading,
    error,
    invite,
    revoke,
    changeRole,
    removeMember,
  } = useMembers(workspaceId);

  const [page, setPage] = useState<Page>("people");
  const [email, setEmail] = useState("");
  /** Somebody tapped out of the directory; the address below is then only a filter. */
  const [person, setPerson] = useState<Person | null>(null);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reopening always starts at the people, whatever page it was left on.
  useEffect(() => {
    if (workspaceId) {
      setPage("people");
      setEmail("");
      setPerson(null);
      setProblem(null);
      setCopied(false);
    }
  }, [workspaceId]);

  const openLink = invitations.find(
    (row) => !row.invitedEmail && row.status === "pending",
  );
  const addressed = invitations.filter((row) => row.status === "pending");

  const send = useMemo(
    () => async () => {
      /*
       * A tapped name wins over the box, for the same reason it does in
       * `ShareNodeForm`: two ways of naming one recipient and a silent preference
       * between them is how somebody ends up inviting the wrong person.
       *
       * It is still sent by address, not by id. `createInvitationRequestSchema`
       * takes an `email` and not a `userId`, and an invitation is not the same act
       * as a share: it makes somebody a member of a space, which is a bigger and
       * more durable thing than being handed a list. The contract is left alone.
       */
      const address = person ? person.user.email : email.trim();
      if (!address) return;
      setBusy(true);
      setProblem(null);
      try {
        await invite({ role, email: address });
        setEmail("");
        setPerson(null);
      } catch {
        // The message the API sent is in English and says which of the several
        // reasons it was; the app says what to do about it in its own words.
        setProblem(
          address.toLowerCase() === user?.email?.toLowerCase()
            ? t("share.errors.yourself")
            : t("share.errors.failed"),
        );
      } finally {
        setBusy(false);
      }
    },
    [email, person, role, invite, user?.email, t],
  );

  const makeLink = useMemo(
    () => async () => {
      setBusy(true);
      setProblem(null);
      try {
        const created = await invite({ role });
        void copy(inviteLinkFor(created.token));
      } catch {
        setProblem(t("share.errors.failed"));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, invite, t],
  );

  const copy = useMemo(
    () => async (link: string) => {
      setCopied(await shareLink(link, workspaceName));
    },
    [workspaceName],
  );

  if (!workspaceId) return null;

  return (
    <>
      <View style={styles.body}>
        {page === "people" ? (
          <PeoplePage
            isLoading={isLoading}
            error={error}
            members={members}
            meId={user?.id ?? null}
            isOwner={isOwner}
            onOpenInvite={() => setPage("invite")}
            onOpenLink={() => setPage("link")}
            onChangeRole={changeRole}
            onRemove={removeMember}
          />
        ) : null}

        {page === "invite" ? (
          <View style={{ gap: theme.spacing.md }}>
            <TextField
              value={email}
              onChangeText={setEmail}
              label={t("share.emailLabel")}
              placeholder={t("share.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="send"
              onSubmitEditing={() => void send()}
            />

            <PersonPicker
              query={email}
              selected={person}
              onPick={setPerson}
              // Members are already in, and an invitation for somebody in the space
              // is an error the server already refuses. Their row says so.
              alreadyHaveIds={members.map((m) => m.user.id)}
            />

            <RolePicker role={role} onPick={setRole} />

            {problem ? (
              <AppText variant="caption" tone="danger">
                {problem}
              </AppText>
            ) : null}

            <Button
              label={t("share.sendInvite")}
              icon="paper-plane-outline"
              fullWidth
              loading={busy}
              disabled={!person && email.trim().length === 0}
              onPress={() => void send()}
            />

            {addressed.length > 0 ? (
              <View style={{ gap: theme.spacing.xs }}>
                <AppText variant="caption" tone="subtle">
                  {t(pluralKey("share.waitingFor", addressed.length), {
                    count: addressed.length,
                  })}
                </AppText>
                {addressed.map((row) => (
                  <PendingRow
                    key={row.id}
                    invitation={row}
                    onRevoke={() => void revoke(row.id)}
                    onCopy={() => void copy(inviteLinkFor(row.token))}
                  />
                ))}
              </View>
            ) : null}

            <Button
              label={t("common.back")}
              variant="ghost"
              fullWidth
              onPress={onBack}
            />
          </View>
        ) : null}

        {page === "link" ? (
          <View style={{ gap: theme.spacing.md }}>
            <AppText variant="body" tone="muted">
              {t("share.linkBody")}
            </AppText>

            <RolePicker role={role} onPick={setRole} />

            {openLink ? (
              <View style={{ gap: theme.spacing.xs }}>
                <AppText variant="caption" tone="subtle">
                  {t("share.linkWaiting", { count: addressed.length })}
                </AppText>
                <PendingRow
                  invitation={openLink}
                  onRevoke={() => void revoke(openLink.id)}
                  onCopy={() => void copy(inviteLinkFor(openLink.token))}
                />
              </View>
            ) : null}

            {problem ? (
              <AppText variant="caption" tone="danger">
                {problem}
              </AppText>
            ) : null}

            <Button
              label={
                openLink
                  ? copied
                    ? t("share.copied")
                    : t("share.copyLink")
                  : t("share.makeLink")
              }
              icon={copied ? "checkmark" : "link-outline"}
              fullWidth
              loading={busy}
              onPress={() =>
                openLink
                  ? void copy(inviteLinkFor(openLink.token))
                  : void makeLink()
              }
            />

            <Button
              label={t("common.back")}
              variant="ghost"
              fullWidth
              onPress={onBack}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}

/**
 * The list of people.
 *
 * The owner is first and cannot be touched, because "remove the owner" is not
 * an operation and offering it is a way to fail. Everybody else's row has its
 * two actions behind a button, so a row is a row and not a menu that opens by
 * accident when somebody is trying to read it.
 */
function PeoplePage({
  isLoading,
  error,
  members,
  meId,
  isOwner,
  onOpenInvite,
  onOpenLink,
  onChangeRole,
  onRemove,
}: {
  isLoading: boolean;
  error: string | null;
  members: WorkspaceMember[];
  meId: string | null;
  isOwner: boolean;
  onOpenInvite: () => void;
  onOpenLink: () => void;
  onChangeRole: (userId: string, role: "editor" | "viewer") => void;
  onRemove: (userId: string) => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  if (isLoading) {
    return (
      <View style={{ paddingVertical: theme.spacing.xl, alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.lg }}
      >
        <AppText variant="body" tone="danger">
          {t("share.errors.offline")}
        </AppText>
        <AppText variant="caption" tone="subtle">
          {t("share.errors.offlineHint")}
        </AppText>
      </View>
    );
  }

  const ordered = [...members].sort((one, two) => {
    if (one.role === "owner") return -1;
    if (two.role === "owner") return 1;
    return one.user.displayName.localeCompare(two.user.displayName);
  });

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {ordered.map((member) => {
        const isMe = member.user.id === meId;
        const canTouch = isOwner && !isMe && member.role !== "owner";

        return (
          <View
            key={member.user.id}
            style={[
              styles.person,
              {
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
              },
            ]}
          >
            {/* The role belongs to the person, so it goes under their name with
                their address, and the space on the right is only for what the
                owner can do about it. A role printed twice in one row is a row
                where you cannot tell which of the two is the one that counts. */}
            <View style={{ gap: 2, flex: 1 }}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {member.user.displayName || member.user.email}
                {isMe ? ` · ${t("share.you")}` : ""}
              </AppText>
              <AppText variant="caption" tone="subtle" numberOfLines={1}>
                {member.user.email}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {t(roleLabelKey(member.role))}
              </AppText>
            </View>

            {canTouch ? (
              <View style={[styles.row, { gap: theme.spacing.xs }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("share.changeRole", {
                    name: member.user.displayName || member.user.email,
                  })}
                  onPress={() =>
                    onChangeRole(
                      member.user.id,
                      member.role === "editor" ? "viewer" : "editor",
                    )
                  }
                  style={({ pressed }) => [
                    styles.small,
                    {
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <AppText variant="caption">
                    {member.role === "editor"
                      ? t("share.makeViewer")
                      : t("share.makeEditor")}
                  </AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("share.removeMember", {
                    name: member.user.displayName || member.user.email,
                  })}
                  onPress={() => onRemove(member.user.id)}
                  style={({ pressed }) => [
                    styles.small,
                    {
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name="close"
                    size={14}
                    color={theme.colors.danger}
                  />
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {isOwner ? (
        <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xs }}>
          <Button
            label={t("share.inviteByEmail")}
            icon="mail-outline"
            fullWidth
            onPress={onOpenInvite}
          />
          <Button
            label={t("share.inviteByLink")}
            icon="link-outline"
            variant="secondary"
            fullWidth
            onPress={onOpenLink}
          />
        </View>
      ) : (
        <AppText variant="caption" tone="subtle">
          {t("share.onlyOwner")}
        </AppText>
      )}
    </View>
  );
}

/** One invitation waiting for an answer, with the link to pass on. */
function PendingRow({
  invitation,
  onCopy,
  onRevoke,
}: {
  invitation: Invitation;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const theme = useTheme();
  const t = useTranslation();

  return (
    <View
      style={[
        styles.person,
        { borderColor: theme.colors.border, borderRadius: theme.radius.md },
      ]}
    >
      <View style={{ gap: 2, flex: 1 }}>
        <AppText variant="body" numberOfLines={1}>
          {invitation.invitedEmail ?? t("share.anyoneWithLink")}
        </AppText>
        <AppText variant="caption" tone="subtle" numberOfLines={1}>
          {t("share.expires", {
            date: new Date(invitation.expiresAt).toLocaleDateString(),
          })}
        </AppText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("share.copyLink")}
        onPress={onCopy}
        style={({ pressed }) => [
          styles.small,
          { borderColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="copy-outline" size={14} color={theme.colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("share.revokeInvite", {
          name: invitation.invitedEmail ?? t("share.anyoneWithLink"),
        })}
        onPress={onRevoke}
        style={({ pressed }) => [
          styles.small,
          { borderColor: theme.colors.border, opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Ionicons name="trash-outline" size={14} color={theme.colors.danger} />
      </Pressable>
    </View>
  );
}

/** Editor or viewer, said in words and not as a dropdown of codes. */
function RolePicker({
  role,
  onPick,
}: {
  role: "editor" | "viewer";
  onPick: (role: "editor" | "viewer") => void;
}) {
  const theme = useTheme();
  const t = useTranslation();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText variant="caption" tone="subtle">
        {t("share.roleLabel")}
      </AppText>
      <View style={[styles.row, { gap: theme.spacing.xs }]}>
        {(["editor", "viewer"] as const).map((option) => {
          const active = option === role;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={t(roleLabelKey(option))}
              accessibilityState={{ selected: active }}
              onPress={() => onPick(option)}
              style={({ pressed }) => [
                styles.role,
                {
                  backgroundColor: active ? theme.colors.accent : "transparent",
                  borderColor: active
                    ? theme.colors.accent
                    : theme.colors.border,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <AppText
                variant="caption"
                style={{
                  color: active ? theme.colors.onAccent : theme.colors.text,
                }}
              >
                {t(roleLabelKey(option))}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <AppText variant="caption" tone="subtle">
        {t(role === "editor" ? "share.roleEditorBody" : "share.roleViewerBody")}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  small: {
    minHeight: 30,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  role: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
