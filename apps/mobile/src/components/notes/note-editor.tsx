import type {
  EnrichedTextInputInstance,
  EnrichedTextInputProps,
  OnChangeStateEvent,
  TextShortcut,
} from "react-native-enriched-html";
import { EnrichedTextInput } from "react-native-enriched-html";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The note editor and its toolbar.
 *
 * `EnrichedTextInput` is uncontrolled: the document goes in through
 * `defaultValue` and comes out through `getHTML()`. That is not a detail, it is
 * the whole reason this screen does not lag. A controlled editor re-renders on
 * every keystroke with the document in the props, and on a phone that is the
 * difference between typing and watching a caret stutter.
 *
 * So `onChangeText` is the cheap signal that something changed, and the HTML is
 * read on demand, when the autosave decides it is worth the cost. The library
 * warns about exactly this: parsing HTML per keystroke is expensive.
 */

export interface NoteEditorProps
  extends Pick<
    EnrichedTextInputProps,
    "defaultValue" | "placeholder" | "autoFocus" | "htmlStyle" | "textShortcuts"
  > {
  /** Called when the person types. Cheap: this is the plain text, not the HTML. */
  onChanged: () => void;
  /**
   * Reads the document. The same object the editor writes to, handed over rather
   * than copied, so the screen can call `getHTML()` on its own schedule — which
   * is not the same as the moment a keystroke happens.
   */
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
}

/** A style the toolbar can turn on and off over the current selection. */
type StyleKey =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "codeblock"
  | "ul"
  | "ol"
  | "checkbox";

interface ToolbarButton {
  key: StyleKey;
  icon: string;
  /** A screen reader cannot read "B", so every button has a name. */
  labelKey:
    | "note.bold"
    | "note.italic"
    | "note.underline"
    | "note.strike"
    | "note.inlineCode"
    | "note.heading1"
    | "note.heading2"
    | "note.heading3"
    | "note.quote"
    | "note.codeBlock"
    | "note.bulletList"
    | "note.numberedList"
    | "note.checkList";
  /**
   * A letter drawn at this size, for the three headings.
   *
   * They were three of the same icon, and the same icon as bold and italic, so
   * there were five identical glyphs in a row and a person had to press each one
   * to find out. A heading is a *bigger* letter; drawing it that way is the whole
   * difference, and it is what every other editor does.
   */
  glyph?: number;
}

const INLINE_BUTTONS: ToolbarButton[] = [
  { key: "bold", icon: "text", labelKey: "note.bold" },
  { key: "italic", icon: "text-outline", labelKey: "note.italic" },
  { key: "underline", icon: "remove-outline", labelKey: "note.underline" },
  { key: "strike", icon: "strikethrough-variant", labelKey: "note.strike" },
  { key: "code", icon: "code-slash-outline", labelKey: "note.inlineCode" },
];

const BLOCK_BUTTONS: ToolbarButton[] = [
  { key: "h1", icon: "text", labelKey: "note.heading1", glyph: 26 },
  { key: "h2", icon: "text", labelKey: "note.heading2", glyph: 20 },
  { key: "h3", icon: "text", labelKey: "note.heading3", glyph: 16 },
  { key: "quote", icon: "chatbox-outline", labelKey: "note.quote" },
  { key: "codeblock", icon: "code-slash", labelKey: "note.codeBlock" },
  { key: "ul", icon: "list-outline", labelKey: "note.bulletList" },
  { key: "ol", icon: "list", labelKey: "note.numberedList" },
  { key: "checkbox", icon: "checkbox-outline", labelKey: "note.checkList" },
];

/**
 * Typing `- ` at the start of a line makes a bullet, and so on.
 *
 * This was an open question in `notes-editor.md`: the library has no markdown of
 * its own, so a member who relies on `## ` or `- ` to format would have got it
 * on one platform and not another. The editor turns out to have exactly this,
 * and the same set on all three platforms, which is the answer to the question
 * rather than a workaround for it.
 *
 * `1. ` is deliberately absent: a line that begins with a number and a dot is
 * ordinary prose far more often than it is a list item, and turning those into
 * lists loses words.
 */
export const NOTE_TEXT_SHORTCUTS: TextShortcut[] = [
  { trigger: "- ", style: "unordered_list" },
  { trigger: "* ", style: "unordered_list" },
  { trigger: "[] ", style: "checkbox_list" },
  { trigger: "# ", style: "h1" },
  { trigger: "## ", style: "h2" },
  { trigger: "### ", style: "h3" },
  { trigger: "> ", style: "blockquote" },
  { trigger: "``` ", style: "codeblock" },
];

export function NoteEditor({
  defaultValue,
  placeholder,
  autoFocus,
  htmlStyle,
  textShortcuts = NOTE_TEXT_SHORTCUTS,
  onChanged,
  editorRef,
}: NoteEditorProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [state, setState] = useState<OnChangeStateEvent | null>(null);

  const command = useCallback((key: StyleKey) => {
    const input = editorRef.current;
    if (!input) return;
    switch (key) {
      case "bold":
        input.toggleBold();
        break;
      case "italic":
        input.toggleItalic();
        break;
      case "underline":
        input.toggleUnderline();
        break;
      case "strike":
        input.toggleStrikeThrough();
        break;
      case "code":
        input.toggleInlineCode();
        break;
      case "h1":
        input.toggleH1();
        break;
      case "h2":
        input.toggleH2();
        break;
      case "h3":
        input.toggleH3();
        break;
      case "quote":
        input.toggleBlockQuote();
        break;
      case "codeblock":
        input.toggleCodeBlock();
        break;
      case "ul":
        input.toggleUnorderedList();
        break;
      case "ol":
        input.toggleOrderedList();
        break;
      case "checkbox":
        input.toggleCheckboxList(false);
        break;
    }
  }, [editorRef]);

  /**
   * Whether a style is on, from what the editor reports.
   *
   * The editor also says whether a style is *blocked* or *conflicting* here —
   * bold inside a code block, a heading on a quote — and the toolbar shows that
   * rather than pretending the button is simply off. A button that looks inactive
   * and does nothing when pressed is worse than one that says why.
   */
  const statusOf = useCallback(
    (key: StyleKey): "on" | "off" | "blocked" | "conflicting" => {
      if (!state) return "off";
      const entry = (
        state as unknown as Record<
          string,
          { isActive: boolean; isBlocking: boolean; isConflicting: boolean } | undefined
        >
      )[key];
      if (!entry) return "off";
      if (entry.isActive) return "on";
      if (entry.isBlocking) return "blocked";
      if (entry.isConflicting) return "conflicting";
      return "off";
    },
    [state],
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        }}
      >
        {[INLINE_BUTTONS, BLOCK_BUTTONS].map((buttons, rowIndex) => (
          <ScrollView
            key={rowIndex}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: "row",
              gap: theme.spacing.xs,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.xs,
              alignItems: "center",
            }}
          >
            {buttons.map((button) => {
              const status = statusOf(button.key);
              const active = status === "on";
              const dim = status === "blocked" || status === "conflicting";
              return (
                <Pressable
                  key={button.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: status === "blocked" }}
                  accessibilityLabel={t(button.labelKey)}
                  onPress={() => command(button.key)}
                  style={{
                    minWidth: 40,
                    height: 40,
                    borderRadius: theme.radius.sm,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: active ? theme.colors.accentSoft : "transparent",
                  }}
                >
                  {button.glyph ? (
                    <AppText
                      style={{
                        fontSize: button.glyph,
                        lineHeight: button.glyph + 2,
                        fontWeight: "700",
                        color: dim
                          ? theme.colors.textSubtle
                          : active
                            ? theme.colors.accentSoftText
                            : theme.colors.textMuted,
                      }}
                    >
                      A
                    </AppText>
                  ) : (
                    <Ionicons
                      name={button.icon as never}
                      size={19}
                      color={
                        dim
                          ? theme.colors.textSubtle
                          : active
                            ? theme.colors.accentSoftText
                            : theme.colors.textMuted
                      }
                    />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        ))}
      </View>

      <EnrichedTextInput
        ref={editorRef}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        htmlStyle={htmlStyle}
        textShortcuts={textShortcuts}
        onChangeText={onChanged}
        onChangeState={(event) => setState(event.nativeEvent)}
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          color: theme.colors.text,
          fontSize: theme.typography.body.fontSize,
          lineHeight: theme.typography.body.lineHeight,
        }}
      />
    </View>
  );
}

/**
 * How the HTML is drawn, from the theme and nothing else.
 *
 * The editor's own `HtmlStyle` covers a fixed set of tags, so the base text,
 * the bold and the images come from the surrounding text style and the theme,
 * and this only says what the editor needs to be told. A document carries no
 * presentation of its own, which is what `note-document.ts` enforces, and a note
 * that kept its own colours would be unreadable in a palette it was not written
 * for.
 */
export function useNoteHtmlStyle() {
  const theme = useTheme();
  return useMemo(
    () => ({
      h1: { fontSize: 26, bold: true },
      h2: { fontSize: 21, bold: true },
      h3: { fontSize: 18, bold: true },
      blockquote: {
        borderColor: theme.colors.borderStrong,
        borderWidth: 3,
        color: theme.colors.textMuted,
      },
      codeblock: {
        backgroundColor: theme.colors.surfaceSunken,
        color: theme.colors.text,
        borderRadius: theme.radius.sm,
      },
      code: {
        backgroundColor: theme.colors.surfaceSunken,
        color: theme.colors.text,
      },
      a: { color: theme.colors.accent, textDecorationLine: "underline" as const },
      ul: { bulletColor: theme.colors.textMuted, marginLeft: theme.spacing.lg },
      ol: { markerColor: theme.colors.textMuted, marginLeft: theme.spacing.lg },
      ulCheckbox: { boxColor: theme.colors.accent, marginLeft: theme.spacing.lg },
    }),
    [theme],
  );
}
