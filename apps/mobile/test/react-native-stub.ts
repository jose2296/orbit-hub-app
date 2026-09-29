/**
 * The bit of React Native that a Node test can actually have.
 *
 * A module that reaches for `react-native` used to be a module only a device
 * could load, and the tests that touched one were skipped. Then a configuration
 * module started reading `Platform.OS` to work out which address the device
 * should use — a good change — and three suites that had nothing to do with
 * platforms stopped being able to be run at all:
 *
 *   Flow is not supported
 *   node_modules/react-native/index.js:1
 *
 * React Native's entry point is Flow, and the test runner parses it as
 * JavaScript. It is not a question of a missing mock: the file cannot be read.
 *
 * So `react-native` is aliased to this, and the stub answers the only question
 * the configuration asks. Everything here is deliberately dumb — a test that
 * needs a real component is a test that has to run on a device, and pretending
 * otherwise is how a suite starts passing for the wrong reason.
 */
export const Platform: {
  OS: 'ios' | 'android' | 'web';
  /**
   * React Native types this as returning `T`; it returns nothing at all when the
   * spec has no key for the running platform, which is the case a test is most
   * likely to hit by accident. `T | undefined` is what actually comes back, and
   * `tsc` never sees this file anyway — it resolves the real package.
   */
  select<T>(spec: Record<string, T | undefined>): T | undefined;
} = {
  // `web` is the honest default for a Node process: the tests read and write
  // documents, they do not draw them, and a stub that claims to be a phone would
  // quietly exercise the wrong branch of whatever it is used in.
  OS: 'web',
  select: (spec) => spec.web ?? spec.default,
};

export const AppState = {
  currentState: 'active' as const,
  addEventListener: () => () => undefined,
};

export const StyleSheet = {
  create: <T>(styles: T): T => styles,
  flatten: (style: unknown): unknown => style,
  hairlineWidth: 1,
  absoluteFill: {} as unknown,
};

export const PixelRatio = {
  get: () => 1,
  getFontScale: () => 1,
  getPixelSizeForLayoutSize: (size: number) => size,
};

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  addEventListener: () => () => undefined,
};

export const Linking = {
  openURL: async () => true,
  canOpenURL: async () => true,
  addEventListener: () => () => undefined,
  getInitialURL: async () => null,
};

export const Alert = { alert: () => undefined };

export default { Platform, AppState, StyleSheet, PixelRatio, Dimensions, Linking, Alert };
