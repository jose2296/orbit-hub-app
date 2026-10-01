import { LegalDocument } from '@/components/legal/legal-document';
import { useTranslation } from '@/lib/i18n';
import { LEGAL_PRIVACY } from '@/content/legal';

/**
 * `/privacy` — the privacy policy.
 *
 * **Outside every group, on purpose.** `(app)` redirects anybody who is not
 * signed in to the welcome, and `(auth)` redirects the other way, so a document
 * inside either of them is a page you cannot open without a session. This one
 * has to open for the person who has not decided yet whether to make an account:
 * it is the page a store sends somebody to, and somebody following that link is
 * by definition not logged in.
 *
 * The title comes from the dictionary because the native header above draws it
 * in the app's language. The document below does not: it is one language, on
 * purpose, and `content/legal.ts` says why.
 */
export default function PrivacyScreen() {
  const t = useTranslation();

  return <LegalDocument title={t('legal.privacy.title')} document={LEGAL_PRIVACY} />;
}