import type { MembershipRole } from "@orbit-hub/contracts";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The link somebody else has to open, and the words that go with a role.
 *
 * Nothing in here touches the platform, deliberately. This module is the string
 * that leaves the app and gets pasted into a conversation, and a link that is
 * right on a laptop and wrong on a phone is the worst kind of bug: it works in
 * the room where it was written. Asking "is there a window" is the same question
 * as "am I on the web" and does not drag React Native into a file of pure text.
 */
const DEFAULT_WEB_ORIGIN = "https://app.orbithub.com";

/**
 * Where the app lives on the web, for a link that has to be pasted somewhere.
 *
 * On the web it is wherever this copy is running, so a build on a staging
 * address hands out links to staging. Anywhere else it is the address the app is
 * deployed to, which is the same one the mail carries, so a link works from an
 * email on a phone and from a browser on a laptop.
 */
export function webOrigin(): string {
  const here = globalThis as { location?: { origin?: string } };
  const origin = here.location?.origin;
  return typeof origin === "string" && origin.length > 0
    ? origin
    : DEFAULT_WEB_ORIGIN;
}

/** The address that gets somebody into the space. */
export function inviteLinkFor(token: string): string {
  return `${webOrigin().replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
}

/**
 * What somebody can do, as a key the dictionary answers.
 *
 * `editor` and `viewer` are what the contract calls them and nobody outside this
 * codebase should have to know that. A person deciding whether to let their
 * flatmate in is reading "Puede editar", not "editor". A key and not a word,
 * because the app is in two languages and a word here would be Spanish on an
 * English phone.
 */
export function roleLabelKey(role: MembershipRole | string): TranslationKey {
  switch (role) {
    case "owner":
      return "share.roleOwner";
    case "editor":
      return "share.roleEditor";
    default:
      return "share.roleViewer";
  }
}

/**
 * The sentence that says what somebody is about to get, as a key.
 *
 * A whole sentence per role and not the label dropped into a template. "Puede
 * editar" is the name of a thing and reads like a name; inside "Vas a entrar
 * como…" it is a title in the middle of a sentence, which is the sort of detail
 * that makes an app look machine made in the one place where somebody is
 * deciding whether to trust it with their lists.
 */
export function rolePromiseKey(role: MembershipRole | string): TranslationKey {
  switch (role) {
    case "owner":
      return "invite.joinAsOwner";
    case "editor":
      return "invite.joinAsEditor";
    default:
      return "invite.joinAsViewer";
  }
}
