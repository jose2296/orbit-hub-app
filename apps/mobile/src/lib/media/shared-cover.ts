/**
 * The name that ties a poster in a carousel **to the cover on the title's detail**.
 *
 * A shared-element transition is told which two things are the same thing by a
 * string that both of them carry. This is that string, and it is built from the
 * row's own id — the same id the carousel uses as its key and the same one that
 * travels to the detail as `itemKey`, so there is one fact and not three that
 * happen to agree.
 *
 * **It has to be a legal CSS custom-ident**, because on the web it is handed to
 * `view-transition-name` as it is. A `uuid` starts with a hex digit and about a
 * third of the time that digit is a number, and a custom-ident may not. The
 * `cover-` prefix fixes that for every id there is, which is why the prefix is
 * not decoration.
 *
 * **It has to be unique on screen, and the browser is silent when it is not.**
 * Two elements carrying one name do not produce a broken transition: the
 * transition does not happen, and the screen arrives by whatever means it was
 * going to arrive by. That is a very quiet failure for something that looks like
 * a broken promise, and it is why every screen that draws one of these has to
 * take the name **off** when it goes — see `clearSharedCover`.
 *
 * On a phone none of this is used: the same name is a `sharedTransitionTag`, and
 * the platform matches the two views by it without anybody asking the browser.
 */
import type { ImageStyle } from "react-native";

/** The name for one title's cover, from the row's id. */
export function sharedCoverName(itemId: string): string {
  return `cover-${itemId}`;
}

/**
 * The style that hands the name over on the web, **and nothing at all elsewhere.**
 *
 * `view-transition-name` is not a React Native style property and does not appear
 * in its types — it is a CSS property that happens to have a DOM node to live on,
 * and React Native Web passes an unknown property straight through to it. That is
 * why the cast is here and not at the two call sites: the caller writes
 * `sharedCoverStyle(item.id)` in a style array and does not have to know that the
 * name it is writing is one the framework has never heard of, which is the whole
 * of what makes this a helper and not a literal in two files.
 *
 * And why it is not a style in `tokens.ts`: it is a name for the browser's own
 * animation, it is meaningless on Android and iOS, and putting it in the palette
 * would be putting a browser's implementation detail where a designer would expect
 * to find it.
 */
export function sharedCoverStyle(itemId: string): ImageStyle {
  return { viewTransitionName: sharedCoverName(itemId) } as unknown as ImageStyle;
}

/**
 * The same name as a `sharedTransitionTag`, **and today it does nothing.**
 *
 * Reanimated's shared element transition on iOS and Android is behind a **static**
 * feature flag — `ENABLE_SHARED_ELEMENT_TRANSITIONS` — which means it is compiled
 * into the native module and there is no setter for it from JavaScript. Checked
 * against the library this app builds with, not against its documentation: the
 * flag appears in the compiled `libreanimated.so` as
 * `[ENABLE_SHARED_ELEMENT_TRANSITIONS:false]`, and `_configureSharedTransition`
 * returns on its first line when it is false, so the prop is read and dropped.
 *
 * **So this is not a transition yet, it is the wiring for one.** It is kept because
 * the two ends already agree on the name and the day the flag arrives there is
 * nothing left to write — and it costs nothing today, since the prop is not passed
 * on the web and is ignored on a phone. What it must not be is mistaken for
 * something that works: on Android and iOS the poster still cuts, and that is the
 * honest state of it.
 *
 * Turning the flag on means editing the library, which is not a change anybody
 * else would have, so it is a decision to take on its own and not something to do
 * from here.
 *
 * And the prop is not passed on the web either way: there is no web implementation
 * and there is not going to be one, so `undefined` is returned rather than a tag
 * that would be read by nobody.
 */
export function sharedCoverTag(itemId: string): string | undefined {
  if (typeof document !== "undefined") return undefined;
  return sharedCoverName(itemId);
}

/**
 * Takes the name off every element that has it, **and it is the only reason this
 * transition happens at all.**
 *
 * The browser pairs the two halves of a shared element by matching the name in
 * the snapshot before and the snapshot after. **If either snapshot has the name
 * twice, it pairs nothing** — and it does not say so: the transition still runs,
 * the rest of the page still cross-fades, the screen still arrives, and the poster
 * simply does not travel. A broken promise with no error anywhere to look.
 *
 * And the name *is* twice, because the list screen is still in the document. The
 * navigation pushes a screen on top of it and does not take it away — which is
 * right, it is what makes going back instant, and it is why the poster and the
 * cover are both on screen at the moment the transition starts. The poster keeps
 * the name in the snapshot from before, which is what pairs it; the copy of it that
 * is still mounted has to let go before the snapshot from after is taken.
 *
 * **So the release happens inside the transition's own callback.** The snapshot of
 * what was there before is taken *before* the callback runs, and the snapshot of
 * what is there after is taken once the update has painted — so clearing the name
 * in between is exactly the window where the outgoing element stops being part of
 * the "after", and it leaves the "before" alone. Anywhere else, either the old
 * poster loses its name too early, which is a cut, or the new screen keeps two
 * names, which is no transition at all.
 *
 * It is DOM surgery and it is web-only, on purpose: this is the one place in the
 * app that reaches into the document, because this is the one place where the
 * document holds state the framework does not know about. The screen that draws
 * the new cover puts the name back by rendering, which is how it returns.
 */
export function releaseSharedCover(itemId: string): void {
  if (typeof document === "undefined") return;
  const nombre = sharedCoverName(itemId);
  const AGRUPADO = document.querySelectorAll<HTMLElement>(
    `[style*="view-transition-name: ${nombre}"]`,
  );
  for (const nodo of Array.from(AGRUPADO)) {
    nodo.style.viewTransitionName = "";
  }
}