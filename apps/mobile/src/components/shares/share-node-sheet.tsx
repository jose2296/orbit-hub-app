import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { Share, ShareRole } from "@orbit-hub/contracts";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AppText } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useShares } from "@/hooks/use-shares";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

export interface ShareNodeSheetProps {
  /** What is being shared, or `null` when the panel is closed. */
  target: { nodeType: Share["nodeType"]; nodeId: string; title: string } | null;
  onClose: () => void;
  onShared?: () => void;
}

/**
 * Handing something to somebody.
 *
 * A field for the address and two buttons for what they will be able to do, and
 * nothing else. The three things this panel must get right and that are easy to
 * get wrong:
 *
 * - **It says it is a link, before you press anything.** Somebody who is about to
 *   type a colleague's address deserves to know that the other person will be able
 *   to edit the real list, not a snapshot of it, before they do it and not after.
 * - **The roles are named as what the other person gets, not as yours.** "Puede
 *   editar" reads as a statement about the recipient, which is what it is.
 * - **It is not offline-first**, and neither is the share. A grant is decided on
 *   the server when somebody presses this button; queueing it would mean telling
 *   somebody it worked when it has not been decided yet, and there is no retry
 *   that means the same thing twice.
 */
export interface ShareNodeFormProps {
  target: { nodeType: Share["nodeType"]; nodeId: string; title: string };
  /** Called when the share is done, so the panel it is a page of can close. */
  onDone: () => void;
}

/**
 * The form, with no panel around it.
 *
 * Separate from the sheet because a list's menu is *one* panel with pages in it,
 * and "share" is a page of that panel. Wrapping a second sheet inside the first
 * is two backdrops over one screen, and a tap that reaches the wrong one closes
 * what is underneath instead of doing what was asked.
 */
export function ShareNodeForm({ target, onDone }: ShareNodeFormProps) {
  const theme = useTheme();
  const t = useTranslation();
  const { share } = useShares();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async () => {
    const limpio = email.trim().toLowerCase();
    if (!limpio) return;

    setSending(true);
    setError(null);
    try {
      await share({ nodeType: target.nodeType, nodeId: target.nodeId, granteeEmail: limpio, role });
      onDone();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : t("errors.unknown"));
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Ionicons
          name="link-outline"
          size={16}
          color={theme.colors.textMuted}
          style={{ marginTop: 2 }}
        />
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
          {t("share.isALink")}
        </AppText>
      </View>

      <TextField
        value={email}
        onChangeText={setEmail}
        label={t("share.whoseEmail")}
        placeholder="nombre@ejemplo.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        returnKeyType="send"
        onSubmitEditing={() => void enviar()}
      />

      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="caption" tone="subtle">
          {t("share.whatTheyCanDo")}
        </AppText>
        {(["editor", "viewer"] as const).map((opcion) => (
          <Pressable
            key={opcion}
            accessibilityRole="radio"
            accessibilityState={{ selected: role === opcion }}
            accessibilityLabel={t(opcion === "editor" ? "share.canEdit" : "share.canOnlyLook")}
            onPress={() => setRole(opcion)}
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 8,
              alignItems: "flex-start",
              padding: theme.spacing.sm,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: role === opcion ? theme.colors.accent : theme.colors.border,
              backgroundColor:
                role === opcion
                  ? theme.colors.accentSoft
                  : pressed
                    ? theme.colors.surfaceMuted
                    : "transparent",
            })}
          >
            <Ionicons
              name={role === opcion ? "radio-button-on" : "radio-button-off"}
              size={18}
              color={role === opcion ? theme.colors.accent : theme.colors.textMuted}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText
                variant="body"
                style={{ color: role === opcion ? theme.colors.accent : undefined }}
              >
                {t(opcion === "editor" ? "share.canEdit" : "share.canOnlyLook")}
              </AppText>
              <AppText variant="caption" tone="subtle">
                {t(opcion === "editor" ? "share.roleEditorHint" : "share.roleViewerHint")}
              </AppText>
            </View>
          </Pressable>
        ))}
      </View>

      {error ? (
        <AppText variant="caption" style={{ color: theme.colors.danger }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ gap: theme.spacing.sm }}>
        <Button
          label={sending ? t("share.sending") : t("share.send")}
          disabled={email.trim().length === 0 || sending}
          fullWidth
          onPress={() => void enviar()}
        />
        <Button label={t("common.cancel")} variant="ghost" fullWidth onPress={onDone} />
      </View>
    </View>
  );
}

/**
 * The same form inside its own panel, for the places that have no panel to be a
 * page of.
 */
export function ShareNodeSheet({ target, onClose, onShared }: ShareNodeSheetProps) {
  const theme = useTheme();
  const t = useTranslation();

  const [done, setDone] = useState(false);

  if (!target) return null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={target.title}
      subtitle={t("share.subtitle", { name: target.title })}
      scrollable={false}
    >
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        {done ? (
          <View style={{ gap: theme.spacing.sm, alignItems: "flex-start" }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} />
              <AppText variant="callout">{t("share.sent")}</AppText>
            </View>
            <AppText variant="caption" tone="muted">
              {t("share.sentBody")}
            </AppText>
            <Button label={t("common.close")} fullWidth onPress={onClose} />
          </View>
        ) : (
          <ShareNodeForm
            target={target}
            onDone={() => {
              setDone(true);
              onShared?.();
            }}
          />
        )}
      </View>
    </Sheet>
  );
}
