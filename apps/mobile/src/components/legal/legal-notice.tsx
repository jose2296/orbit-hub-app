import { Link } from 'expo-router';

import { AppText } from '@/components/ui/text';
import { useTranslation } from '@/lib/i18n';
import { splitNotice } from '@/lib/legal/notice';

/**
 * "Al continuar aceptas los términos y la política de privacidad", with the two
 * legal documents as links inside the sentence.
 *
 * It replaced a caption that said the same thing in plain text, and that is the
 * whole point: a person being asked to agree has to be able to read what they
 * are agreeing to without leaving the screen they are agreeing on.
 *
 * **The links are not in the checkbox.** That was the other option, and it is
 * worse for a reason that has nothing to do with looks: `Checkbox` is a
 * `Pressable`, so a `Link` inside its label is a `Pressable` inside a
 * `Pressable`. On the web one tap toggles the box *and* navigates, and for a
 * screen reader it is an interactive control nested inside another one. The box
 * keeps its label and the links live in this sentence underneath it.
 */
export function LegalNotice() {
  const t = useTranslation();

  return (
    <AppText variant="caption" tone="subtle" align="center">
      {splitNotice(t('legal.notice')).map((parte, indice) =>
        parte.kind === 'text' ? (
          // The variant is repeated on purpose and must not be "simplified" away.
          // A nested `AppText` re-applies its own variant — the default is
          // `body`, 16 px — so a bare `<AppText>{parte.value}</AppText>` inside a
          // caption renders 16 px text inside a 12 px sentence, and the line
          // height of the row goes with it.
          <AppText key={`texto-${indice}`} variant="caption" tone="subtle">
            {parte.value}
          </AppText>
        ) : (
          <Link key={`enlace-${indice}`} href={parte.href} asChild>
            <AppText variant="caption" tone="accent">
              {t(parte.href === '/terms' ? 'legal.links.terms' : 'legal.links.privacy')}
            </AppText>
          </Link>
        ),
      )}
    </AppText>
  );
}