import React, { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/lib/i18n';
import { balanceIntoColumns, columnsForWidth } from '@/lib/layout/masonry';
import { useTheme } from '@/theme';

export interface MasonryProps {
  children: React.ReactNode;
  /** Width below which a card gets its own column. */
  minColumnWidth?: number;
  maxColumns?: number;
}

/**
 * Masonry layout: columns packed to an even height, each flowing downwards.
 *
 * A grid of rows would leave a gap under every short card, and the dashboard is
 * cards of very different lengths. The column count comes from the measured
 * width rather than the device, so a tablet, a resized browser window and a
 * phone each get what fits.
 */
export function Masonry({
  children,
  minColumnWidth = 300,
  maxColumns = 3,
}: MasonryProps) {
  const theme = useTheme();
  const t = useTranslation();
  const [columns, setColumns] = useState(1);
  const [width, setWidth] = useState(0);

  function onLayout(event: LayoutChangeEvent) {
    const available = event.nativeEvent.layout.width;
    const next = columnsForWidth(available, minColumnWidth, maxColumns);
    // Only a real change re-renders; layout fires on every scroll frame.
    setWidth((previous) => (previous === available ? previous : available));
    setColumns((previous) => (previous === next ? previous : next));
  }

  const items = React.Children.toArray(children);

  if (columns === 1 || width === 0) {
    return (
      <View onLayout={onLayout} style={{ gap: theme.spacing.md }}>
        {items}
      </View>
    );
  }

  const buckets = balanceIntoColumns(
    items.map((child) => estimateHeight(child)),
    columns,
  );

  return (
    <View onLayout={onLayout}>
      <View
        style={[styles.columns, { gap: theme.spacing.md }]}
        accessibilityLabel={t('dashboard.masonryLabel')}
      >
        {buckets.map((bucket, column) => (
          <View key={column} style={[styles.column, { gap: theme.spacing.md }]}>
            {bucket.map((index) => items[index])}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Rough card height, used only so the first paint is already balanced rather
 * than visibly lopsided. The real balance comes from the browser's layout.
 */
function estimateHeight(child: React.ReactNode): number {
  if (!React.isValidElement(child)) return 180;
  const kind = (child.props as { kind?: string }).kind;
  switch (kind) {
    case 'tasks':
    case 'recent_lists':
    case 'quick_actions':
      return 200;
    case 'recent_notes':
      return 260;
    case 'calendar':
      return 320;
    default:
      return 180;
  }
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    flex: 1,
  },
});
