/**
 * The catalogue, part two: the 240 glyphs Ionicons had and nobody had named.
 *
 * The first pass mapped 487 Spanish words and landed on **181 drawings**, because
 * 80 glyphs were shared by several words and eleven of those words ended up on
 * the same trail sign. That left 240 glyphs with both variants unused out of the
 * 421 Ionicons has — nearly two thirds of the set, and the reason the picker felt
 * short.
 *
 * Five of these words already existed with a **different** glyph — `alarma` pointed
 * at `warning`, `compartir` at `share-social`, `bolsa` at `bag-handle` — and the
 * ones Ionicons has for what they actually name were sitting unused. They are
 * re-pointed below and the old glyphs go back into the free list.
 *
 * Two rules held while writing this, and both come from what went wrong before:
 *
 * - **One glyph, one drawing.** Every entry below points at a glyph no other
 *   entry uses, so nothing here collapses into a neighbour. The test for repeated
 *   drawings covers the whole catalogue, this part included.
 * - **A real glyph name, never an invented one.** `vectorGlyph` appends
 *   `-outline` blindly, and a glyph without that variant draws an empty box: the
 *   "Contorno" tab would show blanks and nothing would say why. So every entry
 *   here is a glyph the font really has in both styles, and the test reads the
 *   real `glyphMap` to prove it rather than believing this comment.
 *
 * The format is `clave glifo`: the Spanish word somebody types, and the English
 * name of the glyph that draws it. Words that need spelling out, and words that
 * should find something they are not called, live in the tables below rather than
 * encoded in the key.
 */

/** The categories this part adds to, and the words each one holds. */
export const EXTRA_BY_CATEGORY: Record<string, readonly string[]> = {
  hogar: [
    "martillo hammer",
    "carpeta_abierta folder-open",
  ],
  salud: [
    "oido ear",
    "pulso pulse",
  ],
  trabajo: [
    "analitica analytics",
    "marcador bookmark",
    "marcadores bookmarks",
    "construir build",
    "escuela school",
    "biblioteca library",
    "triste sad",
  ],
  viajes: [
    "globo_terra globe",
  ],
  naturaleza: [
    "globo balloon",
    "prismaticos binoculars",
    "telescopio telescope",
    "paracaidas umbrella",
  ],
  deporte: [
    "futbol_americano american-football",
    "beisbol baseball",
    "baloncesto basketball",
    "bolos bowling-ball",
    "golf golf",
    "cronometro stopwatch",
  ],
  social: [
    "femenino female",
    "masculino male",
    "pareja male-female",
    "madre woman",
    "persona_no_binaria transgender",
    "quitar_persona person-remove",
    "no_me_gusta heart-dislike",
    "no_me_gusta_circulo heart-dislike-circle",
    "corazon_medio heart-half",
    "estrella_media star-half",
  ],
  tecnologia: [
    "accesibilidad accessibility",
    "apertura aperture",
    "aplicaciones apps",
    "adjuntar attach",
    "pila_muerta battery-dead",
    "pila_media battery-half",
    "bluetooth bluetooth",
    "microchip hardware-chip",
    "codigo code",
    "descargar_codigo code-download",
    "codigo_tachado code-slash",
    "codigo_procesando code-working",
    "ajustes cog",
    "filtro_color color-filter",
    "paleta color-palette",
    "varita_magica color-wand",
    "invertir invert-mode",
    "rama git-branch",
    "comparar git-compare",
    "fusionar git-merge",
    "solicitud_pull git-pull-request",
    "datos_moviles cellular",
    "infinito infinite",
    "enlace link",
    "desenlazar unlink",
    "escala scale",
    "interfaz options",
  ],
  comunicacion: [
    "conversacion_puntos chatbox-ellipses",
    "burbuja_puntos chatbubble-ellipses",
    "megafono megaphone",
    "micro_silenciado mic-off",
    "micro_silenciado_circulo mic-off-circle",
    "aviso notifications-circle",
    "aviso_fuera notifications-off",
    "aviso_fuera_circulo notifications-off-circle",
    "telefono_apaisado phone-landscape",
    "tableta_apaisada tablet-landscape",
    "pausa pause",
    "pausa_circulo pause-circle",
    "reproducir play",
    "rebobinar play-back",
    "rebobinar_circulo play-back-circle",
    "avanzar play-forward",
    "avanzar_circulo play-forward-circle",
    "saltar_atras play-skip-back",
    "saltar_atras_circulo play-skip-back-circle",
    "saltar_adelante play-skip-forward",
    "saltar_adelante_circulo play-skip-forward-circle",
    "grabar recording",
    "volumen_alto volume-high",
    "volumen_bajo volume-low",
    "silencio volume-mute",
    "apagar_sonido volume-off",
  ],
  general: [
    "agregar add",
    "agregar_circulo add-circle",
    "albumes albums",
    "alerta alert",
    "alerta_circulo alert-circle",
    "atras arrow-back",
    "atras_circulo arrow-back-circle",
    "abajo arrow-down",
    "abajo_circulo arrow-down-circle",
    "abajo_izquierda arrow-down-left-box",
    "abajo_derecha arrow-down-right-box",
    "adelante arrow-forward",
    "adelante_circulo arrow-forward-circle",
    "rehacer arrow-redo",
    "rehacer_circulo arrow-redo-circle",
    "retroceder arrow-undo",
    "retroceder_circulo arrow-undo-circle",
    "arriba arrow-up",
    "arriba_circulo arrow-up-circle",
    "arriba_izquierda arrow-up-left-box",
    "arriba_derecha arrow-up-right-box",
    "prohibir ban",
    "grafico_barras bar-chart",
    "camara camera",
    "carrito cart",
    "efectivo cash",
    "casilla checkbox",
    "marcar checkmark",
    "marcar_circulo checkmark-circle",
    "hecho checkmark-done",
    "portapapeles clipboard",
    "cerrar close",
    "cerrar_circulo close-circle",
    "nube_circulo cloud-circle",
    "nube_completada cloud-done",
    "nube_descargar cloud-download",
    "nube_subir cloud-upload",
    "contraste contrast",
    "recortar crop",
    "rombo diamond",
    "documento_adjunto document-attach",
    "documento_bloqueado document-lock",
    "documentos documents",
    "descargar download",
    "duplicar duplicate",
    "puntos_horizontales ellipsis-horizontal",
    "puntos_horizontales_circulo ellipsis-horizontal-circle",
    "puntos_verticales ellipsis-vertical",
    "puntos_verticales_circulo ellipsis-vertical-circle",
    "entrar enter",
    "salir exit",
    "ampliar expand",
    "extension extension-puzzle",
    "oculto eye-off",
    "filtro filter",
    "filtro_circulo filter-circle",
    "sin_destello flash-off",
    "embudo funnel",
    "ayuda help",
    "ayuda_boya help-buoy",
    "ayuda_circulo help-circle",
    "imagen image",
    "imagenes images",
    "informacion information",
    "informacion_circulo information-circle",
    "idioma language",
    "lista list",
    "lista_circulo list-circle",
    "localizar locate",
    "cerrar_sesion log-out",
    "iman magnet",
    "menu menu",
    "mover move",
    "navegar navigate-circle",
    "nuclear nuclear",
    "abierto open",
    "imprimir print",
    "prisma prism",
    "empujar push",
    "radio radio-button-on",
    "radio_apagada radio-button-off",
    "recibo receipt",
    "refrescar refresh",
    "refrescar_circulo refresh-circle",
    "recargar reload",
    "quitar remove",
    "quitar_circulo remove-circle",
    "reordenar_cuatro reorder-four",
    "reordenar_tres reorder-three",
    "reordenar reorder-two",
    "repetir repeat",
    "redimensionar resize",
    "devolver_abajo_izq return-down-back",
    "devolver_abajo return-down-forward",
    "devolver_arriba_izq return-up-back",
    "devolver_arriba return-up-forward",
    "guardar save",
    "escanear scan-circle",
    "buscar search",
    "buscar_circulo search-circle",
    "enviar send",
    "preferencias settings",
    "formas shapes",
    "escudo shield",
    "escudo_mitad shield-half",
    "barajar shuffle",
    "velocidad speedometer",
    "cuadrado square",
    "parar stop",
    "parar_circulo stop-circle",
    "tienda storefront",
    "intercambiar_horizontal swap-horizontal",
    "intercambiar_vertical swap-vertical",
    "terminal terminal",
    "texto text",
    "hora time",
    "temporizador timer",
    "hoy today",
    "conmutador toggle",
    "papelera trash",
    "papelera_cubo trash-bin",
    "tendencia_baja trending-down",
    "tendencia_alta trending-up",
    "triangulo triangle",
    "cartera wallet",
    "reloj_de_pulsera watch",
    "fila_atras caret-back",
    "fila_atras_circulo caret-back-circle",
    "fila_abajo caret-down",
    "fila_abajo_circulo caret-down-circle",
    "fila_adelante caret-forward",
    "fila_adelante_circulo caret-forward-circle",
    "fila_arriba caret-up",
    "fila_arriba_circulo caret-up-circle",
    "calendario_limpio calendar-clear",
    "calendario_numero calendar-number",
    "probeta beaker",
    "anadir_bolsa bag-add",
    "bolsa_lista bag-check",
    "quitar_bolsa bag-remove",
    "plegar_izquierda chevron-back",
    "plegar_izquierda_circulo chevron-back-circle",
    "contraer chevron-collapse",
    "plegar_abajo chevron-down",
    "plegar_abajo_circulo chevron-down-circle",
    "desplegar chevron-expand",
    "desplegar_derecha chevron-forward",
    "desplegar_derecha_circulo chevron-forward-circle",
    "plegar_arriba chevron-up",
    "plegar_arriba_circulo chevron-up-circle",
  ],
};

/**
 * The words that need spelling out.
 *
 * "pasta_dientes" alone is not something anybody says, and the label is what the
 * grid reads out and what the search shows. A second list of names is a second
 * list to mistype, so it only holds the ones the key cannot spell.
 */
export const EXTRA_LABELS: Record<string, string> = {
  codigo_procesando: "Código procesándose",
  codigo_tachado: "Código tachado",
  no_me_gusta_circulo: "No me gusta (círculo)",
  aviso_fuera_circulo: "Avisos desactivados (círculo)",
};

/**
 * Extra words that should find a drawing they are not called.
 *
 * The key is a drawing and the value the words somebody might type for it that are
 * not its name: "wifi" for the radio button, "email" for the envelope. Not a second
 * name for the drawing -- those are aliases and they live in the catalogue -- but the
 * word a person reaches for and the catalogue would otherwise not answer.
 *
 * Only entries whose key really exists, because a typo here is a word that quietly
 * stops working.
 */
export const EXTRA_KEYWORDS: Record<string, string> = {
  // El perro y el gato dibujan la misma huella: sin esto, "dog" encuentra el
  // perrito caliente y los de servicio pero no la huella, que es el dibujo.
  perro: "dog|mascota|can",
  gato: "cat|mascota|felino|minino",
  datos_moviles: "cobertura|senal|movil|4g",
  radio: "wifi|inalambrico|senal",
  micro_silenciado: "silenciar|mute",
  megafono: "altavoz|anuncio",
  aviso: "notificacion",
  bluetooth: "inalambrico|emparejar",
  microchip: "procesador|cpu|chip",
  terminal: "consola|linea_comandos",
  codigo: "programacion|desarrollo",
  codigo_tachado: "desactivado|error",
  escanear: "qr|leer",
  bolsa: "compras",
  efectivo: "dinero|pagar",
  carrito: "carro|comprar|tienda",
  probeta: "laboratorio|experimento",
  extension: "plugin|complemento",
  salir: "cerrar_sesion|logout",
  entrar: "login|acceder",
};
