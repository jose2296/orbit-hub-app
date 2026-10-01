import { LegalDocument } from '@/components/legal/legal-document';
import { useTranslation } from '@/lib/i18n';
import { LEGAL_TERMS } from '@/content/legal';

/**
 * `/terms` — the terms of service.
 *
 * Public and unguarded for the reason `/privacy` is: both are reached from a
 * sentence somebody is reading on a screen they have not logged into yet.
 */
export default function TermsScreen() {
  const t = useTranslation();

  return <LegalDocument title={t('legal.terms.title')} document={LEGAL_TERMS} />;
}