import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/theme";

import { Button } from "./button";
import { AppText } from "./text";

export interface ConfirmDialogProps {
  visible: boolean;
  /** What is being asked, in a few words. */
  title: string;
  /** What happens if they say yes. */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** The confirming button is the dangerous one: red, and not the accent. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "¿Seguro?" — and it is its own component because `Alert.alert` is not.
 *
 * `Alert` is three different dialogs wearing the same name. On Android it is a
 * system window that follows the platform; on iOS the system sheet; and **on the
 * web `Alert.alert` does not exist at all** in `react-native-web`, so the two
 * confirmations this app had were confirmation on a phone and a silent no-op in a
 * browser. Somebody who loses their edits by tapping the wrong thing on one
 * platform and not on another is not the same app, it is two apps with the same
 * logo.
 *
 * So the question is asked by a `Modal` of this project, which is the same thing
 * on all three targets by construction rather than by promise.
 *
 * And it is **two buttons, always, in the same order**: the one that changes
 * nothing on the left, the one that does something irreversible on the right.
 * Which one is which is the same in every sheet, so it is something you learn
 * once.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        onPress={onCancel}
        style={styles.fondo}
      >
        {/* Stops the tap that opened this from reaching the sheet behind it. */}
        <Pressable onPress={() => {}} style={styles.caja}>
          <View style={styles.cabecera}>
            <AppText variant="heading" style={{ color: theme.colors.text }}>
              {title}
            </AppText>
            <AppText
              variant="body"
              style={{ color: theme.colors.textMuted, marginTop: theme.spacing.sm }}
            >
              {body}
            </AppText>
          </View>

          <View
            style={[
              styles.pie,
              {
                borderTopColor: theme.colors.border,
                paddingTop: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                paddingBottom: theme.spacing.lg,
                gap: theme.spacing.sm,
              },
            ]}
          >
            <Button
              testID="confirm-cancel"
              label={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              style={{ flex: 1 }}
            />
            <Button
              testID="confirm-accept"
              label={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              onPress={onConfirm}
              style={{ flex: 1 }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  caja: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    overflow: "hidden",
  },
  cabecera: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  pie: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});