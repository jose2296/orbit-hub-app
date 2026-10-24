import * as SecureStore from "expo-secure-store";

/**
 * What a widget instance was set up with, kept per `widgetId`.
 *
 * A widget does not live in a screen, so there is nowhere to hold its choice but a store that
 * survives the process: Android starts the JS runtime for each event and throws it away after.
 */
export interface PinnedListConfig {
  listId: string;
}

/** The note a pinned-note widget shows. */
export interface PinnedNoteConfig {
  noteId: string;
}

/** Where the quick-capture buttons go; either one may be left out. */
export interface QuickCaptureConfig {
  /** The task list that "New task" opens on. */
  listId?: string;
  /** The space that "New note" opens on. */
  workspaceId?: string;
}

/** The destinations of a shortcuts widget: what to show and where a tap goes. */
export interface ShortcutsConfig {
  items: Array<{ label: string; uri: string }>;
}

const keyFor = (widgetId: number) => `orbit.widget.${widgetId}`;

export async function readWidgetConfig<T>(widgetId: number): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(widgetId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeWidgetConfig<T>(
  widgetId: number,
  config: T,
): Promise<void> {
  await SecureStore.setItemAsync(keyFor(widgetId), JSON.stringify(config));
}

export async function clearWidgetConfig(widgetId: number): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(widgetId));
  } catch {
    // Nothing to clean up if the store is not there.
  }
}
