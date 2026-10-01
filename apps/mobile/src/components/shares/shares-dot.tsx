import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "@/hooks/use-session";
import { useShares } from "@/hooks/use-shares";
import { useUnseen } from "@/lib/shares/incoming-store";
import { pluralKey, useTranslation } from "@/lib/i18n";
import { useTheme } from "@/theme";

/**
 * The dot on the menu button that says something has been shared with you.
 *
 * A **dot and not a count**, and the reason is the same one `SyncBadge` gives, in the
 * other direction: this dot's only job is to make you open the menu. The number is
 * already in there, next to the list it belongs to, and a second copy of it up here is
 * a number that has to be kept right on a screen that is not about it.
 *
 * It is **not** the sync badge, and it does not sit on top of it. Two dots that mean
 * two different things have to be tellable apart, so this one sits lower on the button
 * rather than fighting for the same corner: "something to resolve" and "something
 * new" are not the same signal and a person who cannot tell them apart is being told
 * about neither.
 *
 * The label lives on the dot and not on the button for the reason `SyncBadge` gives:
 * the button is "open the menu", and announcing "open the menu, 2 new things" describes
 * something the button does not do.
 */
export function SharesDot({ size = 10 }: { size?: number }) {
  const theme = useTheme();
  const t = useTranslation();
  const { status, user } = useSession();
  const { incoming, load } = useShares();

  /*
   * Called here, before anything returns, and that is load-bearing.
   *
   * `useUnseen` is a hook, not the plain function this used to be, and the three
   * `return null` below sit between the declaration and the call if it goes through
   * `useShares` as a function. Then a render with an empty list calls one hook fewer
   * than the render before it and React throws "Rendered more hooks than during the
   * previous render" — which it did, on every screen, with a full cache clear and no
   * hot reload involved.
   *
   * So the count is computed here, once, above every exit.
   */
  const nuevos = useUnseen(
    status === "authenticated" ? (user?.id ?? null) : null,
  );

  /*
   * It fetches for itself, and that is not an accident.
   *
   * `useShares` holds its state per call, so the menu button and the drawer panel are
   * two independent copies of it, and only the panel ever asked. The dot was rendered
   * from a list nobody had loaded, so it never appeared — and the browser check said
   * "the dot is not there" while the badge on the same screen was working.
   *
   * The alternative is lifting the list into one store and reading it from both, which
   * is the right shape and more than this needs. What it costs as written is one extra
   * pair of requests when the button mounts; what it buys is that the dot works in
   * whatever place somebody puts it next.
   */
  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
  }, [load, status]);

  // Nothing signed in, nothing to have missed. Not a zero badge that a sign-out
  // leaves on screen until something forces a reload.
  if (status !== "authenticated" || !user) return null;
  if (incoming.length === 0) return null;
  if (nuevos <= 0) return null;

  return (
    <View
      testID="shares-dot"
      accessibilityLabel={t(pluralKey("drawer.unseenLabel", nuevos), {
        count: nuevos,
      })}
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.accent,
          borderColor: theme.colors.background,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: "absolute",
    // Lower and further out than the sync dot, so the two do not overlap when both
    // are on screen. The sync dot is at `top: 6, right: 6`.
    top: 17,
    right: 2,
    // A ring in the background colour, for the same reason as the other one: the dot
    // should read as sitting *on* the button and not as part of it.
    borderWidth: 2,
  },
});
