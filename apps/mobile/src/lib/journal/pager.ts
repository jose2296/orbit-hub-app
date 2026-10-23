/**
 * El diario en movil se pagina con un desplazamiento horizontal **nativo**, con tres paginas:
 * el dia anterior, el de hoy y el siguiente, y la vista arranca en la de en medio.
 *
 * Se hace asi y no con un gesto de `react-native-gesture-handler` porque en Android el editor
 * (un `EditText` nativo) le quita el toque al gesto: empezaba (`begin`) y terminaba fallido
 * (`finalize ok=false`, desplazamiento 0), asi que arrastrar nunca cambiaba de dia. Un
 * `ScrollView` horizontal es el mecanismo con el que Android ya sabe repartirse los toques con
 * un campo de texto.
 */

/**
 * Hacia donde se fue la persona al terminar de desplazarse: `-1` el dia anterior, `1` el
 * siguiente y `0` si se quedo donde estaba (la pagina de en medio).
 */
export function pageTurn(offsetX: number, pageWidth: number): -1 | 0 | 1 {
  if (pageWidth <= 0) return 0;
  const page = Math.round(offsetX / pageWidth);
  if (page <= 0) return -1;
  if (page >= 2) return 1;
  return 0;
}
