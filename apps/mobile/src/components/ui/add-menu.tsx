import { useCallback, useState, type ComponentProps, type ReactNode } from "react";

import { Sheet, SheetOptions, type SheetOption } from "@/components/ui/sheet";

/** The name of an `Ionicons` glyph, taken from the component so it cannot drift. */
export type AddMenuIcon = ComponentProps<typeof import("@expo/vector-icons").Ionicons>["name"];

export interface AddMenuOption {
  key: string;
  label: string;
  description?: string;
  icon: AddMenuIcon;
  onPress: () => void;
}

export interface AddMenuProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: AddMenuOption[];
  /** Somewhere for a caller to hang an accessibility hint. */
  hintNode?: ReactNode;
}

/**
 * The menu a plus opens, and the only one.
 *
 * Every screen that creates something has a floating plus in the same corner, and
 * each of them used to decide on its own what that plus did. The panel's went
 * straight to the list of things to pin, because there was only one thing to do;
 * the moment a second thing appears — a card, or a whole screen — "the plus opens
 * the only option" is a sheet with one row in it, and a sheet with one row is a
 * tap that could have gone straight where it was going.
 *
 * So the rule is the other way round: **one option does the thing, two open a
 * menu**, and the caller stops having to decide. What that buys is that adding a
 * second thing later does not move the button, does not change what it looks
 * like, and does not put a second button somewhere else for the other thing.
 *
 * The rows are the same rows the rest of the app's menus are made of, on purpose:
 * a menu that reads differently in two places is two menus to learn.
 */
export function AddMenu({
  visible,
  onClose,
  title,
  subtitle,
  options,
  hintNode,
}: AddMenuProps) {
  // Nothing to choose from means nothing to show: a plus that opens an empty
  // sheet is a button that leads nowhere.
  if (!visible || options.length === 0) return null;

  const filas: SheetOption[] = options.map((option) => ({
    key: option.key,
    label: option.label,
    description: option.description,
    icon: option.icon,
    onPress: () => {
      onClose();
      option.onPress();
    },
  }));

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <SheetOptions options={filas} />
      {hintNode}
    </Sheet>
  );
}

/**
 * What a plus should do, given what it can do.
 *
 * `directo` is the one thing to do when there is exactly one thing, and `null`
 * when there is a choice to make — the caller shows a menu on `null` and calls
 * `directo` when it has one. Resolved here rather than in each screen so the
 * decision is one rule in one file instead of the same judgement in six.
 */
export function useAddMenu(options: AddMenuOption[]): {
  /** What to call instead of opening a menu, when there is only one thing to do. */
  directo: (() => void) | null;
  abrir: () => void;
  cerrar: () => void;
  abierto: boolean;
  /** The rows for the menu, or `null` when the plus should just do the thing. */
  menu: AddMenuOption[] | null;
} {
  const [abierto, setAbierto] = useState(false);
  const solo = options.length === 1 ? options[0] : null;

  /*
   * Stable, and it is not a detail.
   *
   * These were two arrow functions written in the returned object literal, so
   * `abrir` was a new function on every render. A screen that puts the plus in the
   * header with `useHeaderAction` then had a new callback on every render, which
   * redrew the header on every render, which re-rendered the layout — and the
   * notes screen came up as `Maximum update depth exceeded` the first time
   * anybody could actually reach it.
   *
   * `useCallback` with no dependencies is the whole fix, and it is exactly right
   * here: `setAbierto` is stable for the life of the component and these two
   * functions do nothing else.
   */
  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);

  return {
    directo: solo ? solo.onPress : null,
    abrir,
    cerrar,
    abierto,
    menu: solo ? null : options,
  };
}
