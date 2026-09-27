import type { Ionicons } from "@expo/vector-icons";
import type { ItemIcon } from "@orbit-hub/contracts";

/** The name of a drawing Ionicons actually has. */
export type Ionicon = keyof typeof Ionicons.glyphMap;

/**
 * The glyph each icon is drawn with.
 *
 * The *filled* Ionicons name. The outline is the same name with `-outline`, so
 * a row can be drawn either way from one entry, and there is a test that
 * checks every icon has both: an icon with no outline would make the style
 * switch do nothing, and nothing about that would say so.
 *
 * Typed as the full set on purpose. An icon the contract has and this map does
 * not is a compile error and not a blank space where the picture should be.
 */
export const ITEM_GLYPHS = {
  pan: "cafe",
  leche: "water",
  agua: "water",
  cafe: "cafe",
  te: "cafe",
  cerveza: "beer",
  vino: "wine",
  refresco: "ice-cream",
  zumo: "nutrition",
  fruta: "nutrition",
  verdura: "leaf",
  queso: "disc",
  huevo: "egg",
  carne: "restaurant",
  pollo: "restaurant",
  pescado: "fish",
  marisco: "fish",
  arroz: "fast-food",
  pasta: "fast-food",
  chocolate: "ice-cream",
  dulces: "gift",
  comida_bebe: "water",
  detergente: "sparkles",
  jabon: "sparkles",
  champu: "brush",
  pasta_dientes: "brush",
  papel: "document-text",
  toallitas: "layers",
  limpieza: "sparkles",
  bolsa: "bag-handle",
  cubierto: "restaurant",
  bombilla: "bulb",
  pila: "battery-charging",
  cargador: "flash",
  herramienta: "construct",
  tornillo: "construct",
  cinta: "layers",
  pegamento: "document-text",
  ropa: "shirt",
  camiseta: "shirt",
  pantalon: "shirt",
  zapato: "footsteps",
  bota: "footsteps",
  abrigo: "shirt",
  calcetin: "footsteps",
  ropa_interior: "shirt",
  bolso: "bag-handle",
  cinturon: "shirt",
  pastilla: "medkit",
  medicina: "medkit",
  tirita: "bandage",
  crema: "flask",
  vitaminas: "fitness",
  termometro: "thermometer",
  bebe: "happy",
  panal: "happy",
  chupete: "happy",
  leche_materna: "water",
  juguete: "happy",
  parque: "happy",
  lampara: "bulb",
  manta: "bed",
  almohada: "bed",
  sabana: "bed",
  toalla: "shirt",
  cortina: "shirt",
  alfombra: "layers",
  mesa: "desktop",
  silla: "desktop",
  vaso: "cafe",
  plato: "restaurant",
  cuchara: "restaurant",
  tenedor: "restaurant",
  olla: "restaurant",
  sarten: "restaurant",
  congelador: "snow",
  lavadora: "shirt",
  aspiradora: "sparkles",
  coche: "car",
  gasolina: "flame",
  aceite: "flame",
  neumatico: "disc",
  bateria_coche: "battery-charging",
  tarjeta_azul: "card",
  billete: "ticket",
  hotel: "bed",
  maleta: "briefcase",
  vuelo: "airplane",
  tren: "train",
  bus: "bus",
  taxi: "car",
  bici: "bicycle",
  casco: "disc",
  perro: "paw",
  gato: "paw",
  comida_perro: "restaurant",
  transportin: "briefcase",
  veterinario: "medkit",
  cuaderno: "book",
  libro: "book",
  boligrafo: "pencil",
  lapiz: "pencil",
  goma: "backspace",
  mochila: "briefcase",
  carpeta: "folder",
  calculadora: "calculator",
  rotulador: "brush",
  tijeras: "cut",
  usb: "power",
  balon: "football",
  tenis: "tennisball",
  gafas: "glasses",
  gorro: "shirt",
  bufanda: "shirt",
  botas: "footsteps",
  bicicleta: "bicycle",
  natacion: "boat",
  gimnasio: "barbell",
  dvd: "tv",
  juego: "game-controller",
  musica: "musical-notes",
  auriculares: "headset",
  regalo: "gift",
  caja: "cube",
  paquete: "cube",
  teclado: "keypad",
  raton: "hand-left",
  monitor: "tv",
  wifi: "wifi",
  bombilla_led: "sunny",
  iluminar: "bulb",
} as const satisfies Record<ItemIcon, Ionicon>;

/**
 * The same glyph drawn as an outline.
 *
 * The one cast in the icon code, and it is a cast because the type system cannot
 * know that `cafe` implies `cafe-outline`: it is a naming convention, not a rule
 * it can check. So it is checked at the other end instead — the test walks every
 * icon and asks Ionicons for both drawings, and an icon with no outline fails
 * there, where the failure says which icon it is.
 */
export function outlineOf(glyph: Ionicon): Ionicon {
  return `${glyph}-outline` as Ionicon;
}
