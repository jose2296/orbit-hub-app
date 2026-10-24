import type { WidgetConfigurationScreenProps } from "react-native-android-widget";

import { writeWidgetConfig } from "./config-store";
import type { PinnedNoteConfig } from "./config-store";
import { ConfigFrame } from "./config-frame";
import { ListPicker } from "./list-picker";
import { loadPinnedNote } from "./note-data";
import { PinnedNoteWidget } from "./note-widget";
import { widgetStrings } from "./strings";
import { bothLooks } from "./widget-views";

/** Picks the note to show, level by level like the sheets of the app. */
export function PinnedNoteConfigScreen({
  widgetInfo,
  renderWidget,
  setResult,
}: WidgetConfigurationScreenProps) {
  const t = widgetStrings();

  const choose = async (noteId: string) => {
    const config: PinnedNoteConfig = { noteId };
    await writeWidgetConfig(widgetInfo.widgetId, config);
    const data = await loadPinnedNote(noteId);
    if (data) {
      renderWidget(
        bothLooks((palette) => (
          <PinnedNoteWidget
            view={{ state: "ready", data }}
            t={t}
            palette={palette}
          />
        )),
      );
    }
    setResult("ok");
  };

  return (
    <ConfigFrame title={t.pickNote} onClose={() => setResult("cancel")}>
      <ListPicker
        kinds={[]}
        onPick={() => undefined}
        onPickNote={(note) => void choose(note.id)}
        emptyLabel={t.nothingHere}
      />
    </ConfigFrame>
  );
}
