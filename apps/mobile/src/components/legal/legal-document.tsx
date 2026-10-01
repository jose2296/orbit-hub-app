import { View } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import type { LegalDocumentData } from '@/content/legal';
import { useTheme } from '@/theme';

export interface LegalDocumentProps {
  /** From the dictionary, because the header above draws it in the app's language. */
  title: string;
  document: LegalDocumentData;
}

/**
 * One layout for the two legal documents.
 *
 * They are the same shape — a title, a date, an introduction and a run of
 * sections — and they are long. That second part is why this is one component
 * and not two screens: a document that is three screens tall needs a column of
 * sentences and not the width of a laptop, so it asks `Screen` for `reading`
 * instead of inheriting whatever the rest of the app uses, and it scrolls.
 *
 * The prose is `bodyLarge` and not `body`. There is a variant in the type scale
 * that exists for exactly this — "the one long text a screen is really about" —
 * and a privacy policy read at 16 px with a 23 px line is a wall rather than a
 * page of reading.
 */
export function LegalDocument({ title, document }: LegalDocumentProps) {
  const theme = useTheme();

  return (
    <Screen width="reading">
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{title}</AppText>
        <AppText variant="caption" tone="subtle">
          {`${document.updatedLabel}: ${document.updatedAt}`}
        </AppText>
      </View>

      <AppText variant="bodyLarge" tone="muted">
        {document.intro}
      </AppText>

      {document.sections.map((section) => (
        <View key={section.heading} style={{ gap: theme.spacing.sm }}>
          <AppText variant="heading">{section.heading}</AppText>
          {section.paragraphs.map((paragraph) => (
            <AppText key={paragraph} variant="bodyLarge" tone="muted">
              {paragraph}
            </AppText>
          ))}
        </View>
      ))}
    </Screen>
  );
}