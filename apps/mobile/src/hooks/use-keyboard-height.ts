import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How tall the keyboard is, in points, and 0 when it is not up.
 *
 * ## Why by hand and not `KeyboardAvoidingView`
 *
 * Because a `Sheet` is a **`Modal`**, and on Android a `Modal` is its own window:
 * a `Dialog`, not the activity. The keyboard is measured against the **activity's**
 * window and the event is delivered there, so a `KeyboardAvoidingView` *inside*
 * the `Modal` does not hear it. This is the reason #3 survived a year of
 * `keyboardShouldPersistTaps="handled"` and a `ScrollView`: nothing in the sheet
 * was ever told the keyboard existed.
 *
 * And the platform's own answer, `android:windowSoftInputMode`, does not reach
 * it either — that adjusts the activity window, and the sheet is not in it.
 *
 * So the height is read from the keyboard events and applied to the panel by
 * hand. On iOS it is `keyboardWillShow` so the panel moves **with** the keyboard
 * and not after it; on Android only `keyboardDidShow` exists, and Android's own
 * window animation covers the gap.
 */
export function useKeyboardHeight(): number {
  const [alto, setAlto] = useState(0);

  useEffect(() => {
    // iOS can say how much it will be before it happens; Android cannot, so
    // asking for it there returns 0 and the panel would jump at the end.
    const mostrar = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const ocultar = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const alMostrar = Keyboard.addListener(mostrar, (event) => {
      setAlto(event.endCoordinates.height);
    });
    const alOcultar = Keyboard.addListener(ocultar, () => {
      setAlto(0);
    });

    return () => {
      alMostrar.remove();
      alOcultar.remove();
    };
  }, []);

  return alto;
}