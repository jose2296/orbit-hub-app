import { z } from "zod";

import {
  MATERIAL_BY_CATEGORY,
  MATERIAL_FILL_ONLY,
  MATERIAL_KEYWORDS,
  MATERIAL_LABELS,
} from "./icons-material.js";

import { EXTRA_BY_CATEGORY, EXTRA_KEYWORDS, EXTRA_LABELS } from "./icons-catalogo-ampliado.js";


/**
 * The colour an icon is drawn in.
 *
 * A key and not a colour value. A hex in the database has no dark mode: it
 * draws the same over a dark surface and there is no way to fix it without
 * a migration, so the name travels and the app resolves it against the
 * theme at the moment it paints. `auto` is the one nobody chose: it takes
 * the colour of whatever the icon is on.
 */
/**
 * The colours an icon can be drawn in.
 *
 * Twelve, and not a colour picker. An icon is a small shape on a busy list, and
 * a colour on it has to be one you can read at that size from a thumb's distance:
 * two reds look like one red, and a pale yellow on white is not a colour, it is
 * nothing. Twelve is as many as stay apart at eighteen points.
 */
export const ITEM_ICON_COLORS = [
  "neutral",
  "accent",
  "green",
  "olive",
  "amber",
  "orange",
  "red",
  "rose",
  "purple",
  "blue",
  "teal",
  "brown",
] as const;
export type ItemIconColor = (typeof ITEM_ICON_COLORS)[number];

export const iconColorSchema = z.enum(["auto", ...ITEM_ICON_COLORS]);
export type IconColor = z.infer<typeof iconColorSchema>;

const emojiIconSchema = z.object({
  type: z.literal("emoji"),
  /** The glyph itself: one to eight code points and no spaces. */
  value: z
    .string()
    .min(1)
    .max(12)
    .refine((v) => [...v].length <= 8 && !/\s/.test(v), {
      message: "not one emoji glyph",
    }),
  color: iconColorSchema.default("auto"),
});

/**
 * Where the drawing comes from.
 *
 * Two fonts in the same package, so adding the second one changed no dependency
 * and no font loading plumbing beyond naming it at the root. An emoji carries no
 * library because the operating system draws it.
 */
export const iconLibrarySchema = z.enum(["ionicons", "material"]);
export type IconLibrary = z.infer<typeof iconLibrarySchema>;

const vectorIconSchema = z.object({
  type: z.literal("vector"),
  /**
   * The word somebody types, and not the name of the glyph: `pan` is typed
   * and `cafe` is drawn. The search finds the word without having to
   * translate it into another language.
   */
  value: z.string().min(1).max(48),
  /*
    Unknown libraries fall back to `ionicons` instead of dropping the icon. A row
    from a build that knows a third library still opens here: the key may even
    resolve, and if it does not, `sanitiseIconRef` below turns it into no icon
    rather than a broken row. Losing the whole picture over one word nobody
    understands is the worse failure.
  */
  library: iconLibrarySchema.default("ionicons").catch("ionicons"),
  style: z.enum(["outline", "fill"]).default("outline"),
  color: iconColorSchema.default("auto"),
});

/**
 * Why a union and not one object with optional fields.
 *
 * With a plain object, `{ type: "emoji", library: "ionicons" }` is a valid
 * icon and no consumer knows what to do with a library on an emoji. Here
 * `library` and `style` do not exist on an emoji because they are not in its
 * shape, which is a whole class of bug that never gets to exist.
 */
export const iconSchema = z.discriminatedUnion("type", [
  emojiIconSchema,
  vectorIconSchema,
]);
export type IconRef = z.infer<typeof iconSchema>;

/** The column. Null is "nobody chose an icon", which the app knows how to draw. */
export const iconRefSchema = iconSchema.nullable();

export const VECTOR_ICON_CATEGORIES = [
  "general",
  "trabajo",
  "tecnologia",
  "comunicacion",
  "comida",
  "hogar",
  "salud",
  "deporte",
  "viajes",
  "naturaleza",
  "social",
] as const;
export type VectorIconCategory = (typeof VECTOR_ICON_CATEGORIES)[number];

/**
 * key -> the filled Ionicons name it is drawn with.
 *
 * A map and not a convention, because the key is the word somebody types and
 * the glyph is the drawing: `pan` is typed, `cafe` is drawn, and there is no
 * `pan-outline`. The outline is that same name with `-outline`, which is a
 * convention no compiler can check, so the test at the other end asks the
 * real glyphmap for both drawings instead.
 */
export const VECTOR_ICON_GLYPHS: Record<string, string> = {
  // trabajo
  cuaderno: "book",
  libro: "book",
  boligrafo: "pencil",
  lapiz: "pencil",
  goma: "backspace",
  carpeta: "folder",
  calculadora: "calculator",
  rotulador: "brush",
  tijeras: "cut",
  usb: "power",
  auriculares: "headset",
  teclado: "keypad",
  raton: "hand-left",
  monitor: "tv",
  wifi: "wifi",
  reunion: "people",
  reuniones: "videocam",
  agenda: "calendar",
  reloj_de_arena: "hourglass",
  hoja_de_calculo: "grid",
  panel: "stats-chart",
  diagrama: "pie-chart",
  objetivo: "flag",
  hito: "trail-sign",
  flujo: "git-network",
  version: "git-commit",
  despliegue: "rocket",
  servidor: "server",
  nube: "cloud",
  copia: "copy",
  archivo: "file-tray",
  carpeta_de_archivos: "file-tray-full",
  contenedor: "cube",
  paquete_de_trabajo: "briefcase",
  correo: "mail",
  correo_abierto: "mail-open",
  bandeja_de_entrada: "file-tray-stacked",
  resumen: "reader",
  informe: "newspaper",
  presentacion: "easel",
  apunte: "journal",
  nota_rapida: "create",
  borrador: "document",
  contrato: "contract",
  firma: "pencil",
  cursor: "hand-left",
  equipo: "people-circle",
  reunion_virtual: "videocam-off",
  micrófono: "mic",
  proyector: "tv",
  auditorio: "people-circle",
  seguridad: "shield-checkmark",
  permisos: "key",
  llave_inglesa: "construct",
  escaneo: "scan",
  codigo_de_barras: "barcode",
  qr: "qr-code",
  firma_digital: "finger-print",
  carpeta_archivada: "archive",
  fuera_de_linea: "cloud-offline",
  sincronizando: "sync",
  sincronizado: "checkmark-done-circle",
  // hogar
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
  gorro: "shirt",
  bufanda: "shirt",
  botas: "footsteps",
  regalo: "gift",
  caja: "cube",
  paquete: "cube",
  bombilla_led: "sunny",
  iluminar: "bulb",
  cocina: "restaurant",
  sarten_carbon: "restaurant",
  horno: "flame",
  fogon: "bonfire",
  nevera: "cube",
  lavadora_ropa: "sync-circle",
  secadora: "reload-circle",
  aspirador: "trail-sign",
  escoba: "brush",
  fregona: "water",
  cubeta: "ellipse",
  esponja: "disc",
  jabon_liquido: "water",
  suavizante: "color-fill",
  lejia: "flask",
  multiusos: "flask",
  insecticida: "bug",
  rodenticide: "skull",
  matafuegos: "flame",
  alarma: "warning",
  botiquin: "medkit",
  extintor: "warning",
  candado: "lock-closed",
  llave: "lock-open",
  ventana: "browsers",
  puerta: "log-in",
  escalerilla: "trail-sign",
  tejado: "home",
  jardin: "leaf",
  planta: "flower",
  maceta: "basket",
  tijeras_de_poda: "cut",
  manguera: "water",
  regadera: "water",
  terraza: "partly-sunny",
  sombra: "cloudy",
  sotano: "cube",
  garaje: "car-sport",
  trastero: "archive",
  cuarto_de_lavado: "sync-circle",
  mesa_de_planchar: "cube",
  percha: "shirt",
  abanico: "navigate",
  estanque: "water",
  piscina: "water",
  sala: "browsers",
  dormitorio: "bed",
  bano: "water",
  espejo: "eye",
  lampara_de_techo: "bulb",
  enchufe: "battery-charging",
  pila_boton: "battery-full",
  movil: "phone-portrait",
  portatil: "laptop",
  ordenador: "desktop",
  tableta: "tablet-portrait",
  altavoz: "volume-medium",
  cargador_usb: "battery-charging",
  // salud
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
  veterinario: "medkit",
  balon: "football",
  tenis: "tennisball",
  gafas: "glasses",
  natacion: "boat",
  gimnasio: "barbell",
  dvd: "tv",
  juego: "game-controller",
  musica: "musical-notes",
  medico: "medkit",
  enfermeria: "medical",
  hospital: "business",
  farmacia: "medkit",
  dentista: "eyedrop",
  optica: "eye",
  gafas_de_sol: "glasses",
  analisis: "flask",
  radiografia: "body",
  masaje: "hand-right",
  dientes: "body",
  cepillo_de_dientes: "brush",
  enjuague: "water",
  higiene: "water",
  gym: "barbell",
  pesas: "barbell",
  correr: "walk",
  caminar: "footsteps",
  nadar: "water",
  yoga: "body",
  pilates: "body",
  meditacion: "moon",
  dormir: "bed",
  sueno: "moon",
  energia: "flash",
  vitaminas_pastillas: "leaf",
  suplementos: "leaf",
  dieta: "nutrition",
  caloria: "nutrition",
  ciclismo: "bicycle",
  // comida
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
  pan_integral: "nutrition",
  pizza: "pizza",
  pasta_italiana: "fast-food",
  ensalada: "leaf",
  verdura_hoja: "leaf",
  fruta_roja: "nutrition",
  banana: "nutrition",
  naranja: "nutrition",
  uva: "nutrition",
  fresa: "nutrition",
  limon: "nutrition",
  aguacate: "leaf",
  pina: "nutrition",
  mango: "nutrition",
  cereza: "nutrition",
  ciruela: "nutrition",
  durazno: "nutrition",
  sandia: "nutrition",
  kiwi: "nutrition",
  zanahoria: "nutrition",
  papa: "nutrition",
  cebolla: "nutrition",
  ajo: "nutrition",
  tomate: "nutrition",
  lechuga: "leaf",
  espinaca: "leaf",
  brocoli: "leaf",
  calabacin: "leaf",
  pimiento: "leaf",
  champinon: "leaf",
  pepino: "leaf",
  tortilla: "nutrition",
  arroz_blanco: "nutrition",
  cuscus: "nutrition",
  quinoa: "nutrition",
  avena: "nutrition",
  miel: "basket",
  azucar: "cube",
  sal: "cube",
  pimienta: "cube",
  aceite_de_oliva: "flask",
  vinagre: "flask",
  mayonesa: "flask",
  mostaza: "flask",
  salsa: "flask",
  especias: "flask",
  cacao: "cafe",
  te_verde: "cafe",
  infusion: "cafe",
  horchata: "cafe",
  zumo_de_naranja: "nutrition",
  batido: "cafe",
  cerveza_art: "beer",
  vino_tinto: "wine",
  vino_blanco: "wine",
  rosado: "wine",
  coctel: "pint",
  vermut: "pint",
  refresco_cola: "cafe",
  zumo_limones: "cafe",
  batido_fresa: "nutrition",
  galleta: "nutrition",
  chocolate_caliente: "cafe",
  croissant: "nutrition",
  magdalena: "nutrition",
  tarta: "nutrition",
  pastel: "nutrition",
  donut: "nutrition",
  helado: "ice-cream",
  turron: "nutrition",
  chicle: "ellipse",
  // viajes
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
  mochila: "briefcase",
  bicicleta: "bicycle",
  maleta_de_cabina: "briefcase",
  equipaje: "briefcase",
  pasaporte: "id-card",
  billete_de_avion: "paper-plane",
  boarding: "qr-code",
  viaje_de_negocios: "briefcase",
  hotel_habitacion: "bed",
  reserva: "calendar",
  vacaciones: "sunny",
  playa: "sunny",
  piscina_hotel: "water",
  senderismo: "trail-sign",
  montana: "trail-sign",
  camping: "bonfire",
  tienda_de_campana: "bonfire",
  saco_de_dormir: "bed",
  linterna: "flashlight",
  mapa: "map",
  brújula: "compass",
  rutas: "navigate",
  ubicacion: "location",
  posicion: "pin",
  taxi_app: "car-sport",
  tren_europpa: "train",
  metro: "subway",
  autobus: "bus",
  bicicleta_de_ciudad: "bicycle",
  patinete: "bicycle",
  moton: "bicycle",
  embarcacion: "boat",
  vela: "boat",
  buzo: "fish",
  buceo: "fish",
  surf: "water",
  esqui: "snow",
  nieve: "snow",
  montana_rusa: "trail-sign",
  parque_nacional: "leaf",
  cascada: "water",
  faro: "flashlight",
  muelle: "boat",
  puerto: "boat",
  isla: "earth",
  // naturaleza
  perro: "paw",
  gato: "paw",
  comida_perro: "restaurant",
  transportin: "briefcase",
  arbol: "leaf",
  bosque: "leaf",
  selva: "leaf",
  flor_roja: "flower",
  rosa: "rose",
  tulipan: "flower",
  girasol: "flower",
  orquidea: "flower",
  cactus: "leaf",
  higuera: "leaf",
  pino: "leaf",
  roble: "leaf",
  cerezo: "flower",
  lila: "flower",
  lavanda: "flower",
  hierba: "leaf",
  musgo: "leaf",
  helecho: "leaf",
  bambu: "leaf",
  palmera: "leaf",
  hoja: "leaf",
  raiz: "trail-sign",
  semilla: "nutrition",
  brote: "leaf",
  montana_verde: "trail-sign",
  valle: "trail-sign",
  canyon: "trail-sign",
  cascada_floresta: "water",
  manantial: "water",
  rio: "water",
  lago: "water",
  mar: "earth",
  playa_floresta: "sunny",
  duna: "trail-sign",
  roca: "cube",
  volcan: "flame",
  fuego: "flame",
  hielo: "snow",
  nube_oscura: "cloudy-night",
  tormenta: "thunderstorm",
  rayo: "flash",
  lluvia: "rainy",
  niebla: "cloudy",
  sol: "sunny",
  luna: "moon",
  estrella: "star",
  planeta: "planet",
  galaxia: "planet",
  cometa: "sparkles",
  // social
  personas: "people",
  grupo: "people-circle",
  equipo_pequeno: "man",
  amigos: "happy",
  fiesta: "sparkles",
  celebracion: "gift",
  cumpleanos: "gift",
  boda: "ribbon",
  aniversario: "heart",
  amor: "heart-circle",
  favorito: "heart",
  like: "thumbs-up",
  dislike: "thumbs-down",
  compartir: "share-social",
  mensaje: "chatbubble",
  conversacion: "chatbubbles",
  llamada: "call",
  videollamada: "videocam",
  contacto: "person-add",
  nuevo_contacto: "person-add",
  perfil: "person",
  cuenta: "person-circle",
  usuario: "man",
  invitado: "people-circle",
  seguidor: "people-circle",
  notificacion: "notifications",
  mencion: "at-circle",
  etiqueta: "pricetag",
  hashtag: "pricetags",
  publicacion: "reader",
  historia: "camera-reverse",
  reels: "play-circle",
  directo: "radio",
  podcast: "mic-circle",
  comunidad: "people-circle",
  anfitrion: "home",
  invitacion: "mail-unread",
  reunion_social: "beer",
  brindis: "pint",
  copas: "wine",
  fiesta_fin: "happy",
  cine: "film",
  cine_en_casa: "videocam",
  television: "tv",
  radio_amigos: "radio",
  musica_casera: "musical-notes",
  baile: "musical-note",
  fiesta_ninos: "happy",
  juegos: "game-controller",
  dados: "dice",
  naipes: "card",
  poker: "card",
  videojuego: "game-controller",
  torneo: "trophy",
  medalla: "medal",
  trofeo: "trophy",
  podium: "podium",
  campeon: "trophy",
};

const KEYS_BY_CATEGORY: Record<VectorIconCategory, string[]> = {
  general: [],
  tecnologia: [],
  comunicacion: [],
  deporte: [],
  trabajo: [
    "cuaderno", "libro", "boligrafo", "lapiz", "goma", "carpeta",
    "calculadora", "rotulador", "tijeras", "usb", "auriculares", "teclado",
    "raton", "monitor", "wifi", "reunion", "reuniones", "agenda",
    "reloj_de_arena", "hoja_de_calculo", "panel", "diagrama", "objetivo", "hito",
    "flujo", "version", "despliegue", "servidor", "nube", "copia",
    "archivo", "carpeta_de_archivos", "contenedor", "paquete_de_trabajo", "correo", "correo_abierto",
    "bandeja_de_entrada", "resumen", "informe", "presentacion", "apunte", "nota_rapida",
    "borrador", "contrato", "firma", "cursor", "equipo", "reunion_virtual",
    "micrófono", "proyector", "auditorio", "seguridad", "permisos", "llave_inglesa",
    "escaneo", "codigo_de_barras", "qr", "firma_digital", "carpeta_archivada", "fuera_de_linea",
    "sincronizando", "sincronizado",
  ],
  hogar: [
    "detergente", "jabon", "champu", "pasta_dientes", "papel", "toallitas",
    "limpieza", "bolsa", "cubierto", "bombilla", "pila", "cargador",
    "herramienta", "tornillo", "cinta", "pegamento", "ropa", "camiseta",
    "pantalon", "zapato", "bota", "abrigo", "calcetin", "ropa_interior",
    "bolso", "cinturon", "lampara", "manta", "almohada", "sabana",
    "toalla", "cortina", "alfombra", "mesa", "silla", "vaso",
    "plato", "cuchara", "tenedor", "olla", "sarten", "congelador",
    "lavadora", "aspiradora", "gorro", "bufanda", "botas", "regalo",
    "caja", "paquete", "bombilla_led", "iluminar", "cocina", "sarten_carbon",
    "horno", "fogon", "nevera", "lavadora_ropa", "secadora", "aspirador",
    "escoba", "fregona", "cubeta", "esponja", "jabon_liquido", "suavizante",
    "lejia", "multiusos", "insecticida", "rodenticide", "matafuegos", "alarma",
    "botiquin", "extintor", "candado", "llave", "ventana", "puerta",
    "escalerilla", "tejado", "jardin", "planta", "maceta", "tijeras_de_poda",
    "manguera", "regadera", "terraza", "sombra", "sotano", "garaje",
    "trastero", "cuarto_de_lavado", "mesa_de_planchar", "percha", "abanico", "estanque",
    "piscina", "sala", "dormitorio", "bano", "espejo", "lampara_de_techo",
    "enchufe", "pila_boton", "movil", "portatil", "ordenador", "tableta",
    "altavoz", "cargador_usb",
  ],
  salud: [
    "pastilla", "medicina", "tirita", "crema", "vitaminas", "termometro",
    "bebe", "panal", "chupete", "leche_materna", "juguete", "parque",
    "veterinario", "balon", "tenis", "gafas", "natacion", "gimnasio",
    "dvd", "juego", "musica", "medico", "enfermeria", "hospital",
    "farmacia", "dentista", "optica", "gafas_de_sol", "analisis", "radiografia",
    "masaje", "dientes", "cepillo_de_dientes", "enjuague", "higiene", "gym",
    "pesas", "correr", "caminar", "nadar", "yoga", "pilates",
    "meditacion", "dormir", "sueno", "energia", "vitaminas_pastillas", "suplementos",
    "dieta", "caloria", "ciclismo",
  ],
  comida: [
    "pan", "leche", "agua", "cafe", "te", "cerveza",
    "vino", "refresco", "zumo", "fruta", "verdura", "queso",
    "huevo", "carne", "pollo", "pescado", "marisco", "arroz",
    "pasta", "chocolate", "dulces", "comida_bebe", "pan_integral", "pizza",
    "pasta_italiana", "ensalada", "verdura_hoja", "fruta_roja", "banana", "naranja",
    "uva", "fresa", "limon", "aguacate", "pina", "mango",
    "cereza", "ciruela", "durazno", "sandia", "kiwi", "zanahoria",
    "papa", "cebolla", "ajo", "tomate", "lechuga", "espinaca",
    "brocoli", "calabacin", "pimiento", "champinon", "pepino", "tortilla",
    "arroz_blanco", "cuscus", "quinoa", "avena", "miel", "azucar",
    "sal", "pimienta", "aceite_de_oliva", "vinagre", "mayonesa", "mostaza",
    "salsa", "especias", "cacao", "te_verde", "infusion", "horchata",
    "zumo_de_naranja", "batido", "cerveza_art", "vino_tinto", "vino_blanco", "rosado",
    "coctel", "vermut", "refresco_cola", "zumo_limones", "batido_fresa", "galleta",
    "chocolate_caliente", "croissant", "magdalena", "tarta", "pastel", "donut",
    "helado", "turron", "chicle",
  ],
  viajes: [
    "coche", "gasolina", "aceite", "neumatico", "bateria_coche", "tarjeta_azul",
    "billete", "hotel", "maleta", "vuelo", "tren", "bus",
    "taxi", "bici", "casco", "mochila", "bicicleta", "maleta_de_cabina",
    "equipaje", "pasaporte", "billete_de_avion", "boarding", "viaje_de_negocios", "hotel_habitacion",
    "reserva", "vacaciones", "playa", "piscina_hotel", "senderismo", "montana",
    "camping", "tienda_de_campana", "saco_de_dormir", "linterna", "mapa", "brújula",
    "rutas", "ubicacion", "posicion", "taxi_app", "tren_europpa", "metro",
    "autobus", "bicicleta_de_ciudad", "patinete", "moton", "embarcacion", "vela",
    "buzo", "buceo", "surf", "esqui", "nieve", "montana_rusa",
    "parque_nacional", "cascada", "faro", "muelle", "puerto", "isla",
  ],
  naturaleza: [
    "perro", "gato", "comida_perro", "transportin", "arbol", "bosque",
    "selva", "flor_roja", "rosa", "tulipan", "girasol", "orquidea",
    "cactus", "higuera", "pino", "roble", "cerezo", "lila",
    "lavanda", "hierba", "musgo", "helecho", "bambu", "palmera",
    "hoja", "raiz", "semilla", "brote", "montana_verde", "valle",
    "canyon", "cascada_floresta", "manantial", "rio", "lago", "mar",
    "playa_floresta", "duna", "roca", "volcan", "fuego", "hielo",
    "nube_oscura", "tormenta", "rayo", "lluvia", "niebla", "sol",
    "luna", "estrella", "planeta", "galaxia", "cometa",
  ],
  social: [
    "personas", "grupo", "equipo_pequeno", "amigos", "fiesta", "celebracion",
    "cumpleanos", "boda", "aniversario", "amor", "favorito", "like",
    "dislike", "compartir", "mensaje", "conversacion", "llamada", "videollamada",
    "contacto", "nuevo_contacto", "perfil", "cuenta", "usuario", "invitado",
    "seguidor", "notificacion", "mencion", "etiqueta", "hashtag", "publicacion",
    "historia", "reels", "directo", "podcast", "comunidad", "anfitrion",
    "invitacion", "reunion_social", "brindis", "copas", "fiesta_fin", "cine",
    "cine_en_casa", "television", "radio_amigos", "musica_casera", "baile", "fiesta_ninos",
    "juegos", "dados", "naipes", "poker", "videojuego", "torneo",
    "medalla", "trofeo", "podium", "campeon",
  ],
};

/**
 * The label is the key in words, and only the words that need spelling out
 * are in the dictionary: "pasta_dientes" alone is not something anybody says.
 * A second list of names is a second list to mistype.
 */
const LABEL_DICTIONARY: Record<string, string> = {
  pasta_dientes: "Pasta de dientes",
  comida_bebe: "Comida de bebé",
  bombilla_led: "Bombilla LED",
};

export function labelOf(key: string): string {
  return (
    LABEL_DICTIONARY[key] ??
    key.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
  );
}

/**
 * The words that find a drawing they are not called, pipe separated.
 *
 * The name is the word somebody types most of the time; these are the others they
 * reach for. A drawing with none of these is found by its name alone, and that is
 * the normal case.
 */
export const VECTOR_ICON_KEYWORDS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(EXTRA_KEYWORDS).map(([key, words]) => [key, words.split("|").filter(Boolean)]),
);

/** The name of each group, in the language the app is in. */
export const VECTOR_ICON_CATEGORY_LABEL: Record<VectorIconCategory, string> = {
  general: "General",
  tecnologia: "Tecnología",
  comunicacion: "Comunicación",
  deporte: "Deporte",
  trabajo: "Trabajo",
  hogar: "Casa y objetos",
  salud: "Salud y deporte",
  comida: "Comida y bebida",
  viajes: "Viajes y transporte",
  naturaleza: "Naturaleza",
  social: "Personas y social",
};

/**
 * The catalogue the picker offers and the server validates against.
 *
 * It lives here and not in either app so there is one list: the API refuses
 * a key it does not know, and the app cannot draw one it does not have, and
 * neither of them can be a step behind the other.
 */
/*
 * The 240 glyphs Ionicons had and nobody had named, folded in.
 *
 * `EXTRA_BY_CATEGORY` is `clave glifo`, and both halves are merged into the two
 * tables above rather than kept beside them: a second list of categories is a
 * second list that is a step behind the first, and the category bar reads
 * `KEYS_BY_CATEGORY` while the server validates `VECTOR_ICON_GLYPHS`. Five keys
 * already existed pointing at a different glyph — `alarma` at `warning`,
 * `compartir` at `share-social` — and are re-pointed at the one that is actually
 * named after them; the glyphs they leave behind go back into the free list.
 */
const REGLIFO: Record<string, string> = {
  alarma: "alarm",
  bolsa: "bag",
  compartir: "share",
  conversacion: "chatbox",
  mencion: "at",
};

for (const [category, entries] of Object.entries(EXTRA_BY_CATEGORY)) {
  const claves = KEYS_BY_CATEGORY[category as VectorIconCategory];
  if (!claves) continue;
  for (const entry of entries) {
    const [key, glyph] = entry.split(" ");
    if (!key || !glyph) continue;
    (claves as string[]).push(key);
    VECTOR_ICON_GLYPHS[key] = glyph;
  }
}

for (const [key, glyph] of Object.entries(REGLIFO)) {
  VECTOR_ICON_GLYPHS[key] = glyph;
}

Object.assign(LABEL_DICTIONARY, EXTRA_LABELS, MATERIAL_LABELS);

for (const [key, words] of Object.entries(MATERIAL_KEYWORDS)) {
  const current = VECTOR_ICON_KEYWORDS[key] ?? [];
  VECTOR_ICON_KEYWORDS[key] = [...current, ...words.split("|").filter(Boolean)];
}


export const VECTOR_ICON_CATALOG: ReadonlyArray<{
  key: string;
  glyph: string;
  category: VectorIconCategory;
  label: string;
  library: IconLibrary;
}> = VECTOR_ICON_CATEGORIES.flatMap((category) => [
  ...KEYS_BY_CATEGORY[category].map((key) => ({
    key,
    glyph: VECTOR_ICON_GLYPHS[key] as string,
    category,
    label: labelOf(key),
    library: "ionicons" as IconLibrary,
  })),
  ...(MATERIAL_BY_CATEGORY[category] ?? []).map((entry) => {
    const [key, glyph] = entry.split(" ");
    return {
      key: key as string,
      glyph: glyph as string,
      category,
      label: labelOf(key as string),
      library: "material" as IconLibrary,
    };
  }),
]);


/**
 * The keys the app offered before there was a catalogue.
 *
 * They are all in `VECTOR_ICON_CATALOG`, and this list is the test that keeps
 * them there: removing one is taking away an icon somebody chose, and the push
 * answers `applied` while the picture disappears. Nobody adds here any more —
 * new icons go in the catalogue with their group and their glyph.
 */
export const ITEM_ICONS = [
  "pan",
  "leche",
  "agua",
  "cafe",
  "te",
  "cerveza",
  "vino",
  "refresco",
  "zumo",
  "fruta",
  "verdura",
  "queso",
  "huevo",
  "carne",
  "pollo",
  "pescado",
  "marisco",
  "arroz",
  "pasta",
  "chocolate",
  "dulces",
  "comida_bebe",
  "detergente",
  "jabon",
  "champu",
  "pasta_dientes",
  "papel",
  "toallitas",
  "limpieza",
  "bolsa",
  "cubierto",
  "bombilla",
  "pila",
  "cargador",
  "herramienta",
  "tornillo",
  "cinta",
  "pegamento",
  "ropa",
  "camiseta",
  "pantalon",
  "zapato",
  "bota",
  "abrigo",
  "calcetin",
  "ropa_interior",
  "bolso",
  "cinturon",
  "pastilla",
  "medicina",
  "tirita",
  "crema",
  "vitaminas",
  "termometro",
  "bebe",
  "panal",
  "chupete",
  "leche_materna",
  "juguete",
  "parque",
  "lampara",
  "manta",
  "almohada",
  "sabana",
  "toalla",
  "cortina",
  "alfombra",
  "mesa",
  "silla",
  "vaso",
  "plato",
  "cuchara",
  "tenedor",
  "olla",
  "sarten",
  "congelador",
  "lavadora",
  "aspiradora",
  "coche",
  "gasolina",
  "aceite",
  "neumatico",
  "bateria_coche",
  "tarjeta_azul",
  "billete",
  "hotel",
  "maleta",
  "vuelo",
  "tren",
  "bus",
  "taxi",
  "bici",
  "casco",
  "perro",
  "gato",
  "comida_perro",
  "transportin",
  "veterinario",
  "cuaderno",
  "libro",
  "boligrafo",
  "lapiz",
  "goma",
  "mochila",
  "carpeta",
  "calculadora",
  "rotulador",
  "tijeras",
  "usb",
  "balon",
  "tenis",
  "gafas",
  "gorro",
  "bufanda",
  "botas",
  "bicicleta",
  "natacion",
  "gimnasio",
  "dvd",
  "juego",
  "musica",
  "auriculares",
  "regalo",
  "caja",
  "paquete",
  "teclado",
  "raton",
  "monitor",
  "wifi",
  "bombilla_led",
  "iluminar",
] as const;

const CATALOG_KEYS = new Set(VECTOR_ICON_CATALOG.map((entry) => entry.key));

/** Whether this build can draw the value. `pan` is a key, `cafe-outline` is not. */
export function isVectorIcon(value: unknown): value is string {
  return typeof value === "string" && CATALOG_KEYS.has(value);
}

/** The keys of one group, in catalogue order. */
export function vectorIconsOf(category: VectorIconCategory): string[] {
  return [...KEYS_BY_CATEGORY[category]];
}

/**
 * key -> the MaterialCommunityIcons name it is drawn with.
 *
 * Same shape as `VECTOR_ICON_GLYPHS` and for the same reason: the key is the
 * Spanish word and the glyph is the English drawing name. Kept apart from the
 * Ionicons map because the resolution differs — see `vectorGlyph` — and one map
 * keyed by word with two behaviours inside is a lookup that lies about half its
 * entries.
 */
export const MATERIAL_ICON_GLYPHS: Record<string, string> = (() => {
  const mapa: Record<string, string> = {};
  for (const entries of Object.values(MATERIAL_BY_CATEGORY)) {
    for (const entry of entries) {
      const [key, glyph] = entry.split(" ");
      if (key && glyph) mapa[key] = glyph;
    }
  }
  return mapa;
})();

/** The material keys of one group, in catalogue order. */
export function materialIconsOf(category: VectorIconCategory): string[] {
  return (MATERIAL_BY_CATEGORY[category] ?? []).map((entry) => entry.split(" ")[0] as string);
}

/**
 * The name of the drawing, or null when there is no drawing.
 *
 * Null and not a made-up name: a key with `-outline` stuck on it is a glyph that
 * does not exist, and an icon component asked for a glyph it does not have renders
 * an empty Text and says nothing about it.
 *
 * The two libraries resolve differently, which is why this takes the library
 * instead of guessing it from the key. Ionicons derives the outline from the fill
 * by convention; Material names its outline versions as separate glyphs, and most
 * simply have none — those draw the same picture in both styles (see
 * `MATERIAL_FILL_ONLY`) rather than hiding an icon that can be chosen.
 */
export function vectorGlyph(
  key: string,
  style: "outline" | "fill",
  library: IconLibrary = "ionicons",
): string | null {
  if (library === "material") {
    const glyph = MATERIAL_ICON_GLYPHS[key];
    if (!glyph) return null;
    if (style === "fill" || MATERIAL_FILL_ONLY.has(key)) return glyph;
    return `${glyph}-outline`;
  }
  const glyph = VECTOR_ICON_GLYPHS[key];
  if (!glyph) return null;
  return style === "fill" ? glyph : `${glyph}-outline`;
}

/** Whether a key resolves to a drawing in this library and style. */
export function canDrawVector(
  key: string,
  style: "outline" | "fill",
  library: IconLibrary = "ionicons",
): boolean {
  return vectorGlyph(key, style, library) !== null;
}

/**
 * An icon that can be drawn, or null.
 *
 * Null and never a throw: this runs where a row is read or written, and a key
 * this build does not have is not an error — it is a row from a future build, or
 * a payload somebody edited by hand, and either way the row around it still
 * opens.
 */
export function sanitiseIconRef(value: unknown): IconRef | null {
  const parsed = iconSchema.safeParse(value);
  if (parsed.success) {
    if (parsed.data.type === "vector" && !isVectorIcon(parsed.data.value)) return null;
    return parsed.data;
  }

  // A colour this build does not have is a colour nobody chose, and one option
  // away from an icon somebody did choose: \`.default()\` does not rescue it,
  // because a default answers for an absent value and not for a wrong one, so
  // without this the whole icon is dropped over its colour. A row from a future
  // build, or a payload edited by hand, keeps its picture.
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;

  if (row["type"] === "emoji" && typeof row["value"] === "string") {
    const colour = iconColorSchema.safeParse(row["color"] ?? "auto");
    return { type: "emoji", value: row["value"], color: colour.success ? colour.data : "auto" };
  }

  if (row["type"] === "vector" && typeof row["value"] === "string" && row["value"].length > 0) {
    // An absent library is the Ionicons one: every icon stored before there were
    // two libraries has none. An unknown one is not rescued into either, because it
    // is the one field that says WHICH drawings the key means.
    const library = row["library"] === undefined ? "ionicons" : row["library"];
    if (library !== "ionicons" && library !== "material") return null;
    if (!isVectorIcon(row["value"])) return null;
    const colour = iconColorSchema.safeParse(row["color"] ?? "auto");
    const style = row["style"] === "fill" ? "fill" : "outline";
    return {
      type: "vector",
      value: row["value"],
      library,
      style,
      color: colour.success ? colour.data : "auto",
    };
  }

  return null;
}
