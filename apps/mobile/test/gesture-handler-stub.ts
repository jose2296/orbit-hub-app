import { createElement, forwardRef, useImperativeHandle } from 'react';

/**
 * `react-native-gesture-handler` ships Flow-typed sources a test cannot parse, so
 * anything that renders a swipeable row died at import. The stub is a passthrough:
 * a test cares about what the row draws, not about the drag.
 */
export const Swipeable = forwardRef(function Swipeable(
  { children }: { children?: unknown },
  ref,
) {
  useImperativeHandle(ref, () => ({ close() {}, openRight() {} }));
  return createElement('Swipeable', null, children as never);
});
