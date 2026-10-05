/**
 * How long a field may be, and what to say about it.
 *
 * Every one of these numbers lived in three places that were not connected: the
 * schema in `packages/contracts`, the `varchar` width in `content-schema.ts`, and
 * a `.slice()` in the sync sanitiser. They disagreed, and the disagreement was not
 * cosmetic — a workspace name of 81 characters passed the sanitiser's 120 and came
 * back as a **500**, on ordinary input, with `The operation failed` as the only
 * thing the device was told. A note title of 121 characters lost 80 of them
 * silently, and the push still answered `applied`.
 *
 * So the limits are exported as data from the contracts, where the validation
 * already was, and everything else reads them from here. One number, and the
 * counter under a field is the same number the server will hold.
 */

import {
  ATTACHMENT_MAX_BYTES_DEFAULT,
  FOLDER_NAME_MAX,
  LIST_DESCRIPTION_MAX,
  LIST_ITEM_ANNOTATION_MAX,
  LIST_ITEM_TITLE_MAX,
  LIST_TITLE_MAX,
  NOTE_TITLE_MAX,
  TAG_MAX,
  WORKSPACE_DESCRIPTION_MAX,
  WORKSPACE_NAME_MAX,
} from '@orbit-hub/contracts';

/** The fields a person types a title or a name into, and their widths. */
export const FIELD_LIMITS = {
  'workspace.name': WORKSPACE_NAME_MAX,
  'workspace.description': WORKSPACE_DESCRIPTION_MAX,
  'folder.name': FOLDER_NAME_MAX,
  'list.title': LIST_TITLE_MAX,
  'list.description': LIST_DESCRIPTION_MAX,
  'list_item.title': LIST_ITEM_TITLE_MAX,
  'list_item.annotation': LIST_ITEM_ANNOTATION_MAX,
  'note.title': NOTE_TITLE_MAX,
  'list_item.tag': TAG_MAX,
  'attachment.bytes': ATTACHMENT_MAX_BYTES_DEFAULT,
} as const;

export type FieldKey = keyof typeof FIELD_LIMITS;

/** How a counter should read, given what has been typed so far. */
export interface CounterState {
  /** `10 / 300`, the way a person reads a limit. */
  value: string;
  tone: 'subtle' | 'muted' | 'danger';
  /** True once the field is full and the text cannot be saved whole. */
  atLimit: boolean;
  /** True in the last stretch, before it is actually too late. */
  nearlyFull: boolean;
}

/** How close to the limit the counter starts changing colour. */
const AVISO = 10;

/**
 * `length` counts UTF-16 units, which is what `String.length` says and what
 * `maxLength` caps on both platforms — so the counter and the cap agree by
 * construction. It does not count what a person sees: an emoji is two units and
 * a flag with a ZWJ sequence is several. That is why this is a warning and not a
 * ban.
 */
export function counterState(value: string, max: number): CounterState {
  const usado = (value ?? '').length;
  const restantes = max - usado;

  return {
    value: `${usado} / ${max}`,
    tone: restantes <= 0 ? 'danger' : restantes <= AVISO ? 'muted' : 'subtle',
    atLimit: restantes <= 0,
    nearlyFull: restantes > 0 && restantes <= AVISO,
  };
}
