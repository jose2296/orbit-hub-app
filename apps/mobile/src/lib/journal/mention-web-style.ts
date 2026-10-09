/**
 * The rounded corners of a chip, on the web only.
 *
 * The library paints a chip's background and colour, and nothing else: it has no
 * radius and no padding in its style. On the web a chip is an element in the page, so
 * its corners can be given by a rule. On a phone the chip keeps square corners, which
 * is a limit of the library and not a choice made here.
 */

const RULE = `
.eti-editor mention, .et-view mention {
  border-radius: 999px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}`;

let installed = false;

/** Adds the chip rule to the page once. Does nothing on the phone. */
export function installMentionChipStyle(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.setAttribute("data-orbit-mention-chips", "");
  style.textContent = RULE;
  document.head.appendChild(style);
}
