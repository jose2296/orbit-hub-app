import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

import { AppText } from "./text";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Short line under the title, for context. */
  subtitle?: string;
  /**
   * A picture beside the title.
   *
   * For the sheet of a film, where the title alone does not say which one: two
   * sheets with "Salsa de la abuela" open at once and there is no way to tell them
   * apart. It is the **cover**, and it sits on the left of the text because that
   * is where a face goes.
   *
   * Drawn by the caller and not fetched here, so the sheet has no idea what a
   * poster is: it gets a node of the right size and leaves it alone.
   */
  artwork?: ReactNode;
  children: ReactNode;
  /** Renders the content in a scroll view, for a long list of options. */
  scrollable?: boolean;
  /** Caps the height on a tall screen so a long list does not run off it. */
  maxHeightRatio?: number;
}

/**
 * A panel of options that rises from the bottom on a phone and sits in the
 * middle of the screen on a wide one.
 *
 * Options are the recurring shape of this app: creating a thing, the menu of a
 * list, the filters of a view, the sort order. On a phone they belong in a
 * panel that slides up from the bottom edge, where the thumb already is, and on
 * a wide screen a panel glued to the bottom of a 1200px column is a strip
 * nobody reads, so it becomes a dialog in the middle. One component with two
 * shapes, because the difference is a style and not a different screen.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  artwork,
  children,
  scrollable = true,
  maxHeightRatio = 0.85,
}: SheetProps) {
  const theme = useTheme();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const wide = isWide();

  const Body = scrollable ? ScrollView : View;

  return (
    <Modal
      visible={visible}
      transparent
      animationType={wide ? "fade" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* The dimming is on this view and not on a separate backdrop view.
          An absolutely positioned backdrop that is a sibling of the panel is
          painted *over* it, because positioned elements paint above the ones in
          normal flow, and on web that left the panel floating on a screen that
          was exactly as bright as before. Painting it here, on the thing that is
          painted first, cannot come out in the wrong order. */}
      <View
        style={[
          styles.root,
          wide ? styles.rootWide : styles.rootNarrow,
          { backgroundColor: theme.colors.overlay },
        ]}
      >
        {/* The tap outside closes, which is the only way out on a wide screen
            where there is no edge to drag from. It is there to be pressed, not
            to be seen. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          style={styles.backdrop}
        />

        <View
          style={[
            wide ? styles.panelWide : styles.panelNarrow,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
              paddingBottom: wide
                ? theme.spacing.lg
                : insets.bottom + theme.spacing.lg,
            },
          ]}
        >
          <View style={styles.grabberArea}>
            {wide ? null : (
              <View
                style={[
                  styles.grabber,
                  { backgroundColor: theme.colors.borderStrong },
                ]}
              />
            )}
            {/*
              The header row, and **the artwork goes to the left of the text and
              not above it**: a sheet whose title moves down half a line depending
              *whether there is a cover* is a sheet whose close button and grabber
              *move with it. One row, one height, the same whether there is a
              picture or not.
            */}
            {artwork || title ? (
              <View style={[styles.cabecera, { gap: theme.spacing.md }]}>
                {artwork}
                {title ? (
                  <View style={{ gap: 2, flexShrink: 1 }}>
                    <AppText variant="heading" numberOfLines={1}>
                      {title}
                    </AppText>
                    {subtitle ? (
                      <AppText variant="caption" tone="muted" numberOfLines={1}>
                        {subtitle}
                      </AppText>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              hitSlop={10}
              onPress={onClose}
              style={({ pressed }) => [
                styles.close,
                {
                  backgroundColor: theme.colors.surfaceMuted,
                  borderRadius: theme.radius.pill,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="close" size={16} color={theme.colors.text} />
            </Pressable>
          </View>

          <Body
            {...(scrollable
              ? {
                  contentContainerStyle: { paddingTop: theme.spacing.sm },
                  showsVerticalScrollIndicator: false,
                  keyboardShouldPersistTaps: "handled" as const,
                }
              : { style: { paddingTop: theme.spacing.sm } })}
          >
            {children}
          </Body>
        </View>
      </View>
    </Modal>
  );
}

export interface SheetOption {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  description?: string;
  tone?: "default" | "danger" | "accent";
  disabled?: boolean;
  /**
   * The option is a choice and this one is the chosen one: a tick on the right.
   *
   * A menu option does not need it, because pressing it *is* choosing it. An
   * option that toggles something the sheet then leaves open does: a picker of
   * what is on the panel has to say which things are on it, and the only place
   * that can be said is the row itself. Without it the state lives in the
   * description, where it is one sentence of every row and the first thing to be
   * read past.
   */
  selected?: boolean;
  /**
   * The option is a door and not a switch: a chevron, and pressing it goes
   * somewhere instead of changing something.
   *
   * The same shape `ListRow` already has, because a row that goes somewhere and
   * a row that does a thing are told apart the same way everywhere in the app.
   */
  chevron?: boolean;
  /**
   * A second control on the right, for the row that is both.
   *
   * A folder in the panel picker is the only thing in the app that is a door and
   * a switch at the same time: pressing the row goes into the folder, and the
   * circle beside it puts the folder on the panel. Folding that into the one
   * pressable is what it was doing before, and one pressable can only answer one
   * question — so the row went into the folder when the folder was not pinned and
   * pinned it when it was, and the chevron and the tick took turns being the
   * right one. A control that changes what it means depending on its own state is
   * a control nobody can predict.
   *
   * So the two are two controls: the row is the door, the circle is the switch,
   * and the circle says in its label which of the two it is doing.
   */
  trailingAction?: {
    accessibilityLabel: string;
    selected: boolean;
    onPress: () => void;
  };
  /**
   * What the line does, and **it is missing when the line is not a door**.
   *
   * A row that says "Ya está en la lista" is a state, and a state that answers to
   * a press is a lie with a finger on it: it looks exactly like the ones that do
   * something and it does nothing. So the type lets the two apart — with
   * `disabled` and no `onPress` it is drawn as a state, and with both it is drawn
   * as an action — instead of forcing the caller to pass a function that does
   * nothing.
   */
  onPress?: () => void;
}

/**
 * The menu of a thing: what you can do with a list, a folder or a space.
 *
 * Destructive options are last and red, so the one that cannot be undone is not
 * the one under the thumb at the top of the panel.
 */
export function SheetOptions({ options }: { options: SheetOption[] }) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {options.map((option, index) => (
        <SheetOptionRow key={option.key} option={option} first={index === 0} />
      ))}
    </View>
  );
}

/**
 * One row of the menu, in its own component so the hint hook is not called
 * once per option inside a loop.
 */
function SheetOptionRow({ option, first }: { option: SheetOption; first: boolean }) {
  const theme = useTheme();
  const t = useTranslation();

  // Optional: an option without a description has nothing to describe.
  /*
   * No hint here, and on purpose: the description is already painted inside the
   * button, so a screen reader reaches it on its own as part of the control.
   * Pointing `aria-describedby` at a second copy of the same sentence means the
   * same words twice — once as the content of the button and once as its
   * description — and the version that is only a hint is the one people learn to
   * skip.
   *
   * The hint is for the descriptions that are *not* on screen: the ones that
   * explain what pressing a button you cannot see the meaning of will do.
   */

  const danger = option.tone === "danger";
  const accent = option.tone === "accent";
  const color = danger
    ? theme.colors.danger
    : accent
      ? theme.colors.accent
      : theme.colors.text;

  /**
   * The second control, read once.
   *
   * A local and not `option.trailingAction` at each use, because the style is a
   * callback that TypeScript will not narrow across: it checks the property on
   * the way in and then cannot promise it is still there inside the closure.
   */
  const trailing = option.trailingAction;

  return (
    <View>
      {first ? null : (
        <View
          style={[
            styles.separator,
            { backgroundColor: theme.colors.border },
          ]}
        />
      )}
      {/*
        The row, and **it is a `Pressable` only when there is something to press**.
         *
        A line that says "Ya está en la lista" is a state, and drawn as a button it
        is a button that does nothing: the same size, the same place, the same
        response to a tap as the ones that work, and the only way to tell is to tap
        it and find out. So the two are different elements and not one element
        with a flag.
      */}
      {option.onPress ? (
      <Pressable
        accessibilityRole="button"
        /*
          The state in words, and not only as `accessibilityState.selected`.
          That attribute has no valid form on a button on the web — a button is
          not an option, so there is no `aria-selected` for it and it is not
          written at all — and what is left telling a chosen row from an
          unchosen one is a tick, which is invisible to a screen reader and to
          anybody who cannot separate the accent from the border.
        */
        accessibilityLabel={
          option.selected ? `${option.label}, ${t("dashboard.pinned")}` : option.label
        }
        disabled={option.disabled}
        onPress={option.onPress}
        style={({ pressed }) => [
          styles.option,
          {
            backgroundColor: pressed ? theme.colors.surfaceMuted : "transparent",
            opacity: option.disabled ? 0.4 : 1,
          },
        ]}
      >
        {option.icon ? <Ionicons name={option.icon} size={18} color={color} /> : null}
        <View style={[styles.optionText, { gap: 2 }]}>
          <AppText variant="body" style={{ color }}>
            {option.label}
          </AppText>
          {option.description ? (
            <AppText variant="caption" tone="subtle" numberOfLines={2}>
              {option.description}
            </AppText>
          ) : null}
        </View>
        {option.selected ? (
          <Ionicons name="checkmark" size={18} color={theme.colors.accent} />
        ) : option.chevron ? (
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textSubtle} />
        ) : null}
        {/*
          The second control, when the row has two things to be.

          Nested inside the row's own `Pressable` on purpose: the circle is the
          switch and the rest of the row is the door, and a finger on the circle
          has to reach the circle and not the row behind it. The circle is bigger
          than the glyph inside it, because it is a target and not an icon, and it
          stops its own press from also opening the folder.
        */}
        {trailing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={trailing.accessibilityLabel}
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              trailing.onPress();
            }}
            style={({ pressed }) => [
              styles.trailing,
              {
                borderColor: trailing.selected
                  ? theme.colors.accent
                  : theme.colors.border,
                backgroundColor: trailing.selected
                  ? theme.colors.accent
                  : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              name="checkmark"
              size={12}
              color={
                trailing.selected
                  ? theme.colors.onAccent
                  : theme.colors.textSubtle
              }
            />
          </Pressable>
        ) : null}
      </Pressable>
      ) : (
          /*
            The same row without being a button, for the ones that are a state.
             *
            Same styles, same place, same height — a row that only says "Ya está en
            la lista" and moves half a line when it stops being pressable is a row
            that reflows a menu, and the menu is where you are reading.
          */
          <View style={[styles.option, { backgroundColor: "transparent", opacity: 0.7 }]}>
            {option.icon ? <Ionicons name={option.icon} size={18} color={color} /> : null}
            <View style={[styles.optionText, { gap: 2 }]}>
              <AppText variant="body" style={{ color }}>
                {option.label}
              </AppText>
              {option.description ? (
                <AppText variant="caption" tone="subtle" numberOfLines={2}>
                  {option.description}
                </AppText>
              ) : null}
            </View>
          </View>
        )}
    </View>
  );
}

/** A wide screen is one where a bottom panel is a strip, not a panel. */
export function isWide(): boolean {
  if (Platform.OS !== "web") return false;
  return (globalThis as { innerWidth?: number }).innerWidth
    ? (globalThis as { innerWidth: number }).innerWidth >= 900
    : false;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  rootNarrow: {},
  rootWide: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  panelNarrow: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    paddingTop: 8,
  },
  panelWide: {
    width: 460,
    maxWidth: "100%",
    borderRadius: 18,
    borderWidth: 1,
    paddingTop: 14,
    // `boxShadow` and not the `shadow*` family: React Native Web dropped those
    // props and warns on every render, and the new architecture takes the CSS
    // form on native too, so one property covers the three targets.
    boxShadow: "0px 12px 30px rgba(0, 0, 0, 0.35)",
    elevation: 12,
  },
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
  },
  grabberArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 6,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  close: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  optionText: {
    flex: 1,
  },
  trailing: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  separator: {
    height: 1,
    marginLeft: 48,
  },
});
