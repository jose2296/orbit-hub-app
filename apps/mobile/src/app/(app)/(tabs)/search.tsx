import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { useTranslation } from '@/lib/i18n';
import { useTheme } from '@/theme';

export default function SearchScreen() {
  const theme = useTheme();
  const t = useTranslation();
  const [query, setQuery] = useState('');

  return (
    <Screen>
      <View style={{ gap: theme.spacing.xs }}>
        <AppText variant="title">{t('tabs.search')}</AppText>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <Card padded={false} style={styles.flex}>
        {query.trim().length > 0 ? (
          <EmptyState compact title={t('search.noResults.title')} description={t('search.noResults.body')} />
        ) : (
          <View style={styles.center}>
            <EmptyState
              icon="search-outline"
              title={t('search.empty.title')}
              description={t('search.empty.body')}
            />
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
});
