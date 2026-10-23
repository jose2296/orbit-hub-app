/**
 * Cuando alguien esta escribiendo de verdad en un editor.
 *
 * En la web basta el foco: solo llega con un clic. En un movil **no**: Android le da el foco
 * al primer campo de texto en cuanto se abre la pantalla, sin teclado y sin que nadie haya
 * tocado nada, y tomarlo por "escribiendo" apagaba el swipe entre dias del diario y sacaba
 * la barra de formato nada mas entrar. Escribir en un movil es tener el foco **y** el teclado
 * en pantalla.
 */
export function isTyping(args: {
  focused: boolean;
  keyboardHeight: number;
  platform: string;
}): boolean {
  if (args.platform === "web") return args.focused;
  return args.focused && args.keyboardHeight > 0;
}
