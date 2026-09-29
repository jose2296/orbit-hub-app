import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * A screen's own button in the header, and the one way to put one there.
 *
 * The obvious way is `navigation.setOptions({ headerRight })` from the screen,
 * and it does not work in this app. A `Stack.Screen` in the layout that carries
 * any `options` re-applies them on every render of that layout — on the theme, on
 * the session, on the width — and re-applying **replaces** the screen's whole
 * options object. So the layout's declaration wins, always, and everything the
 * screen set is thrown away.
 *
 * Measured, with the tabs gone and the panel as a plain screen: the header's
 * right slot was rendered, 297 px wide, and empty, on every visit. With the
 * title it was worse — the layout said "Inicio" and the screen said the greeting,
 * and "Inicio" won; then the layout said nothing and the route name "index" won.
 * A screen cannot own a slot the layout also owns.
 *
 * So the division is the other way round. The layout renders the slot, because
 * the layout is what draws the header; the screen says what goes in it, because
 * the screen is what knows. The value is a **function** and not an element, so
 * nothing is compared by identity and a screen that re-renders on every frame of
 * an animation cannot loop the header.
 */
type HeaderAction = (() => ReactNode) | null;

/**
 * The setter takes a plain value and not React's `SetStateAction`, and that is
 * the whole fix.
 *
 * React's `setState` reads a function argument as an **updater**: you hand it
 * `(prev) => next` and it calls it. The value this context publishes is a
 * function, so `setAction(estable)` was never storing `estable` — it was
 * storing `estable(null)`, which is the *button's JSX*, an object. The context
 * then held a React element where a function was expected, and the header called
 * it: `action ? action() : null` → `Object is not a function`.
 *
 * The type was `Dispatch<SetStateAction<HeaderAction>>`, which accepts both, and
 * that is the trap: it compiled. A file that reads
 * "updaters included" in its own comment has been given permission to make this
 * mistake, and the permission is what let it through. Typing it as "takes a
 * value" makes the mistake a type error, which is the only place a mistake like
 * this is cheap.
 */
/**
 * The setter is React's own, **updater and all**, because the published value is
 * a function and `setAction(estable)` is read as an updater rather than as a
 * value. Typing it as "takes a value" would not have stopped that line at the
 * compiler either, which is how it reached a running app.
 */
const Contexto = createContext<{
  action: HeaderAction;
  /** Changes whenever a screen's button needs redrawing. See `useHeaderAction`. */
  version: number;
  publish: Dispatch<SetStateAction<HeaderAction>>;
  invalidate: () => void;
}>({ action: null, version: 0, publish: () => {}, invalidate: () => {} });

/**
 * Wraps the navigator. One per navigation root, and the layout is the only
 * sensible place: it is the component that draws the header.
 */
export function HeaderActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<HeaderAction>(null);
  const [version, invalidate] = useReducer((n: number) => n + 1, 0);
  const value = useMemo(
    () => ({ action, version, publish: setAction, invalidate }),
    [action, version],
  );
  return <Contexto.Provider value={value}>{children}</Contexto.Provider>;
}

/**
 * What the layout puts in the header's right slot: the current action, or
 * nothing. Read **once** in the layout body and closed over, because the slot is
 * a render callback and calling a hook inside it is not rendering a component.
 */
export function useHeaderActionSlot(): () => ReactNode {
  const { action } = useContext(Contexto);
  return useCallback(() => (action ? action() : null), [action]);
}

/**
 * Puts this screen's button in the header, and takes it away on the way out.
 *
 * `render` is called every time the header is drawn, so the button reflects the
 * screen's state at that moment — which is what makes the panel's corner say the
 * pencil while you are looking and Guardar while you are arranging, from the same
 * declaration.
 *
 * Passing `null` on unmount matters: without it a screen that publishes an
 * action and then goes away leaves its button in the header of the screen that
 * took its place, and a button that acts on something you are no longer looking
 * at is worse than no button.
 */
export function useHeaderAction(render: HeaderAction, deps: readonly unknown[]): void {
  const { publish, invalidate } = useContext(Contexto);

  /**
   * The drawing function, kept in a ref and published **once**.
   *
   * Publishing `render` itself re-runs the effect on every render of the screen,
   * because `render` is a new function every time — and a screen that re-renders
   * is normal: a hint hook that builds its object inline, a state that changes, a
   * list that arrives. Each of those would publish, the provider would re-render,
   * the layout would re-render, and the cycle would close. Measured, and loudly:
   * `Maximum update depth exceeded` in the panel, with a blank screen.
   *
   * A ref is the fix and not a `useCallback` on the caller's side, because the
   * caller cannot be relied on to get the dependencies right — and a header that a
   * screen can only fill by getting its memoisation exactly right is a trap.
   */
  const actual = useRef(render);
  actual.current = render;

  const estable = useCallback<() => ReactNode>(() => {
    const fn = actual.current;
    return fn ? fn() : null;
  }, []);

  useLayoutEffect(() => {
    /*
      `publish(() => estable)` and **not** `publish(estable)`.

      What is stored here is a function, and a function handed straight to a
      `useState` setter is not a value: React takes it for an updater and stores
      what it returns. So the published "action" was the *button element* the
      function drew, and the header called it — `action is not a function`, thrown
      from inside the header, blank screen, nothing in the tree to point at.
    */
    publish(() => estable);
    return () => publish(null);
  }, [estable, publish]);

  /**
   * And the redraw, on the caller's own terms.
   *
   * The dependencies are the caller's, and they have to be **specific**: a hook
   * that builds its object inline, or a list that arrives, puts a new value in the
   * array on every render and this redraws the header on every render too. That
   * is not the loop above — the layout re-rendering does not re-render the screen
   * — but it is a header being redrawn for no reason, which is how the next person
   * finds this.
   */
  useLayoutEffect(() => {
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
