import type {
  EnrichedTextInputInstance,
  EnrichedTextInputProps,
  OnChangeStateEvent,
  TextShortcut,
} from "react-native-enriched-html";
import { EnrichedTextInput } from "react-native-enriched-html";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n";
import { mentionStyleMap } from "@/lib/journal/mention-style";
import { installMentionChipStyle } from "@/lib/journal/mention-web-style";
import { NOTE_SANITIZATION } from "@/lib/notes/sanitization";
import { NOTE_BODY_FONT } from "@/theme/tokens";
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

export interface NoteEditorProps extends Pick<
  EnrichedTextInputProps,
  "defaultValue" | "placeholder" | "autoFocus" | "textShortcuts"
> {
  /**
   * Which URIs survive the editor's sanitiser.
   *
   * The library runs every document through DOMPurify before handing it to
   * tiptap, and DOMPurify's default allow-list has no `blob:` in it. The browser
   * is the only platform where a picture is a `blob:` URL — a phone has a file in
   * its cache — so the default silently emptied every `src` on the web: the note
   * opened with a picture-shaped hole in it, and saving it wrote `<img src="">`,
   * which `note-document` rejects. The pictures were never broken; the editor
   * was refusing to be told where they were.
   *
   * It has to be spelled out rather than extended: `ALLOWED_URI_REGEXP` replaces
   * the default instead of adding to it, so the standard protocols are written
   * out again here. Anything not on this list is still refused.
   */
  sanitizationConfig?: EnrichedTextInputProps["sanitizationConfig"];
  /** Called when the person types. Cheap: this is the plain text, not the HTML. */
  onChanged: () => void;
  /**
   * Puts a picture where the cursor is.
   *
   * The screen owns this and not the editor, because it owns the note: choosing
   * the file, sending it, and deciding what happens when there is no connection
   * are all things that need the note's id and the upload queue. The editor knows
   * where the cursor is and nothing else.
   */
  onInsertImage?: () => void;
  /**
   * Reads the document. The same object the editor writes to, handed over rather
   * than copied, so the screen can call `getHTML()` on its own schedule — which
   * is not the same as the moment a keystroke happens.
   */
  editorRef: React.RefObject<EnrichedTextInputInstance | null>;
  /**
   * Shows the document and does not let anybody change it.
   *
   * For reading a template from the catalogue: it is the app's own text, an edit
   * would be replaced by the next build, and a screen that let somebody type into
   * it and then refused to save is worse than a screen that never let them start.
   *
   * The toolbar goes with it. Buttons that are pressed and do nothing are a bug
   * report, so a read-only editor has no toolbar to press.
   */
  readOnly?: boolean;
  /**
   * Asks the screen to choose something to mention: a list, a note, a folder.
   *
   * Called from the `@` button and from typing `@`, which the editor reports the
   * same way. The screen opens its picker and, when something is picked, puts the
   * mention in with `setMention` on the editor ref. Leaving it out means the editor
   * has no mentions at all: no button, and typing `@` is just a character.
   */
  onMentionRequest?: (source: "toolbar" | "typed") => void;
}

/** A style the toolbar can turn on and off over the current selection. */
type StyleKey =
  | "image"
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
  | "checkbox"
  | "mention";

interface ToolbarButton {
  key: StyleKey;
  icon: string;
  /** A screen reader cannot read "B", so every button has a name. */
  labelKey:
    | "note.insertImage"
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
    | "note.checkList"
    | "note.mention";
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
 * The one button that is not a style.
 *
 * Every other button turns something on or off over the selection. This one
 * inserts a picture, which means choosing a file, sending it, and putting the
 * result where the cursor is — so it cannot be a `StyleKey` and does not answer
 * to `onChangeState`. It lives in a row of its own for the same reason: a
 * toolbar that scrolls mixes the two and the person cannot tell which is which.
 */
const IMAGE_BUTTON: ToolbarButton = {
  key: "image",
  icon: "image-outline",
  labelKey: "note.insertImage",
};

const MENTION_BUTTON: ToolbarButton = {
  key: "mention",
  icon: "at-outline",
  labelKey: "note.mention",
};

/**
 * The rows of the toolbar, for what this editor can do.
 *
 * A row with only one button in it looks like a stray control, so the mention
 * joins the block row when there is no picture row for it to share.
 */
function toolbarRows({ image, mention }: { image: boolean; mention: boolean }): ToolbarButton[][] {
  const tail = [...(image ? [IMAGE_BUTTON] : []), ...(mention && image ? [MENTION_BUTTON] : [])];
  const block = [...BLOCK_BUTTONS, ...(mention && !image ? [MENTION_BUTTON] : [])];
  return [INLINE_BUTTONS, block, tail].filter((row) => row.length > 0);
}

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
  textShortcuts = NOTE_TEXT_SHORTCUTS,
  onChanged,
  onInsertImage,
  onMentionRequest,
  editorRef,
  readOnly = false,
  sanitizationConfig = NOTE_SANITIZATION,
}: NoteEditorProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [state, setState] = useState<OnChangeStateEvent | null>(null);
  // Whether the person is typing in the editor. A `@` in a document that is merely
  // being drawn is reported as a trigger too, and only a `@` typed while focused
  // should open the picker.
  const focused = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web") installMentionChipStyle();
  }, []);
  const { htmlStyle, bodyStyle } = useNoteHtmlStyle();

  const command = useCallback(
    (key: StyleKey) => {
      const input = editorRef.current;
      if (!input) return;
      switch (key) {
        case "image":
          // Not a style, and not something the editor can be told to do on its own:
          // a picture has to be chosen, sent and put somewhere first.
          onInsertImage?.();
          return;
        case "mention":
          // Nothing is inserted here. The `@` is put in when something is picked,
          // so cancelling the picker leaves no stray indicator behind for the
          // editor to take as a mention the next time the page opens.
          onMentionRequest?.("toolbar");
          return;
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
    },
    [editorRef, onInsertImage, onMentionRequest],
  );

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
          | { isActive: boolean; isBlocking: boolean; isConflicting: boolean }
          | undefined
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
      {readOnly ? null : (
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          }}
        >
          {toolbarRows({ image: !!onInsertImage, mention: !!onMentionRequest }).map(
            (buttons, rowIndex) => (
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
                      accessibilityState={{
                        selected: active,
                        disabled: status === "blocked",
                      }}
                      accessibilityLabel={t(button.labelKey)}
                      onPress={() => command(button.key)}
                      style={{
                        minWidth: 40,
                        height: 40,
                        borderRadius: theme.radius.sm,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active
                          ? theme.colors.accentSoft
                          : "transparent",
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
            ),
          )}
        </View>
      )}

      <EnrichedTextInput
        ref={editorRef}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        editable={!readOnly}
        sanitizationConfig={sanitizationConfig}
        htmlStyle={htmlStyle}
        textShortcuts={textShortcuts}
        onChangeText={onChanged}
        onChangeState={(event) => setState(event.nativeEvent)}
        mentionIndicators={onMentionRequest ? ["@"] : undefined}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onStartMention={
          onMentionRequest
            ? () => {
                if (focused.current) onMentionRequest("typed");
              }
            : undefined
        }
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          // The type comes from the hook and not from here. Written out again it
          // would be the one place in the editor that could disagree with the
          // scale, and it would be the place nobody looks.
          ...bodyStyle,
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
/**
 * The type the editor draws with, and the only place it is decided.
 *
 * `htmlStyle` cannot reach the body text: it styles blocks by name, and a
 * paragraph is not a block it names. The base size is a property of the input
 * itself, and it arrives through `style` — the same prop that carries the flex
 * box, because on the native side the view reads `fontSize` out of the flattened
 * style. So the body is set here and the headings in `htmlStyle`, and both come
 * from the same tokens.
 *
 * The three heading levels map onto the scale's own steps rather than onto
 * numbers of their own: `title` for the first, `heading` for the second, and
 * `bodyStrong`'s size for the third — the library can only make a heading a size
 * and a weight, so a third invented size would be a number with nowhere to come
 * from. Sixteen bold against sixteen regular is the difference you see, and it is
 * the same difference `bodyStrong` already draws everywhere else in the app.
 */
export function useNoteHtmlStyle() {
  const theme = useTheme();
  const type = theme.typography;

  const htmlStyle = useMemo(
    () => ({
      h1: { fontSize: type.title.fontSize, bold: true },
      h2: { fontSize: type.heading.fontSize, bold: true },
      h3: { fontSize: type.bodyStrong.fontSize, bold: true },
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
      a: {
        color: theme.colors.accent,
        textDecorationLine: "underline" as const,
      },
      // A chip is drawn in the accent, on the soft accent, and is never underlined:
      // it is a control, and a link-shaped word would look like one that is not.
      // One style per space colour, keyed by the chip's indicator, so a chip is painted
      // as the space it belongs to. See lib/journal/mention-style.ts.
      mention: mentionStyleMap({
        color: theme.colors.accentSoftText,
        background: theme.colors.accentSoft,
      }),
      ul: { bulletColor: theme.colors.textMuted, marginLeft: theme.spacing.lg },
      ol: { markerColor: theme.colors.textMuted, marginLeft: theme.spacing.lg },
      /**
       * The same box the app draws in `ui/checkbox.tsx`: 22 px, square corners
       * rounded to the small radius, in the accent. The editor draws its own and
       * there is no way to hand it a component, so the numbers are copied rather
       * than shared — which is the one thing in this file that can drift, and the
       * test pins it to the checkbox's own size so a change to one is a change to
       * both.
       */
      ulCheckbox: {
        boxSize: 22,
        gapWidth: theme.spacing.sm,
        marginLeft: theme.spacing.sm,
        boxColor: theme.colors.accent,
      },
    }),
    [theme, type],
  );

  /**
   * The body's own type, for the `style` prop.
   *
   * Without this the editor draws at the platform's default, which is not what
   * anything else in the app uses — the note read as a different app rather than
   * as a screen of this one.
   *
   * **Y ahora también la familia, que era lo que faltaba.** El tamaño estaba aquí desde
   * hacía tiempo y la letra no: `fontFamily` no estaba, así que la nota se dibujaba con
   * Roboto en Android, con San Francisco en iOS y con la del navegador en la web —tres
   * letras para el mismo texto, que es la misma mentira que el comentario de arriba
   * denuncia pero por el otro lado—. Ahora sale de `NOTE_BODY_FONT`, una pila de
   * serifas del sistema: gratis en las tres plataformas y sin salto de carga.
   */
  const bodyStyle = useMemo(
    () => ({
      fontFamily: NOTE_BODY_FONT,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
      color: theme.colors.text,
    }),
    [theme.colors.text, type.body],
  );

  return { htmlStyle, bodyStyle };
}
