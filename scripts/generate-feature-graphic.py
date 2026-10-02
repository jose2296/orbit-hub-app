#!/usr/bin/env python3
"""La imagen destacada de Play: 1024x500, PNG.

    python3 scripts/generate-feature-graphic.py

Play la pide **exactamente** en 1024x500 — ni 1024x501 ni 512x250 — y responde
`Invalid dimensions` si no es exacta. El icono de la app son 512x512 porque Play
lo exige así, y las dos medidas no coinciden por nada: son dos superficies
distintas, la una cuadrada en el listado y la otra apaisada donde se recorta el
ancho.

**El PNG se genera y no se commitea a mano**, por el mismo motivo que
`generate-brand-assets.mjs`: los colores salen de los tokens del tema y el
binario es un artefacto, no una fuente de verdad.

## Por qué una fuente del sistema

El primer intento pintaba el titular con un abecedario de 5x7 dibujado a mano
para no meter una dependencia. Salió mal de una forma que no se ve en el código:
las celdas avanzaban seis columnas con glifos de cinco, y el resultado era
"ORBITHUB" escrito como "OREITHULIE" — que es el peor tipo de fallo posible en
una imagen de marca, porque se ve bien en el repositorio y se ve mal en todas
partes. El texto de una marca no se dibuja a mano: se compone con una fuente.

La fuente es del sistema (`/System/Library/Fonts`), así que este script solo
funciona en macOS. Para las demás plataformas, el PNG ya está en
`fastlane/metadata/android/es-ES/images/` y es lo que se sube; regenerarlo es
para cambiar textos o colores, no hace falta en cada build.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ANCHO = 1024
ALTO = 500

# Los dos extremos del lavado de un espacio, del tema (tokens.ts).
DESDE = (0x3B, 0x63, 0xE0)
HASTA = (0x7C, 0x3A, 0xED)

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "fastlane" / "metadata" / "android" / "es-ES" / "images" / "featureGraphic.png"

FUENTES = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
FUENTES_CURSIVA = Path("/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf")
FUENTES_PIE = Path("/System/Library/Fonts/Supplemental/Arial.ttf")

# La misma fuente en varios tamaños, porque una sola instancia no dibuja dos
# escalas: `ImageFont.truetype` es una fuente por tamaño, no una fuente con
# parámetros.
def fuente(ruta: Path, tamano: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(ruta), tamano)


def degradado() -> Image.Image:
    """El degradado va en diagonal, no en vertical.

    El ángulo de un degradado se mide contra la caja, y esta es de 1024x500: dos
    de ancho por uno de alto. En vertical el ojo lee una franja plana; en
    diagonal lee una superficie. Es el mismo argumento que `anguloDiagonal` en
    `lib/workspace/wash.ts`, aplicado a una caja de otro tamaño.
    """
    img = Image.new("RGB", (ANCHO, ALTO))
    pixeles = img.load()
    for y in range(ALTO):
        for x in range(ANCHO):
            t = (x / ANCHO) * 0.65 + (y / ALTO) * 0.35
            pixeles[x, y] = tuple(
                round(c + (h - c) * min(1.0, t)) for c, h in zip(DESDE, HASTA)
            )
    return img


def logo(dibujo: ImageDraw.ImageDraw, centro_x: int, centro_y: int) -> None:
    """El anillo y el punto de `icon.png`, redibujados y no escalados.

    El icono de la app es un PNG de 1024 con su alfa y su anti-aliasing
    propios, y pegado aquí a 1024x500 se vería un borde escalonado. Dibujar y
    escalar juntos salen limpios.
    """
    radio, grosor = 46, 13
    blanco = (255, 255, 255)
    dibujo.ellipse(
        [centro_x - radio, centro_y - radio, centro_x + radio, centro_y + radio],
        outline=blanco,
        width=grosor,
    )
    punto = 13
    dibujo.ellipse(
        [centro_x - punto, centro_y - punto, centro_x + punto, centro_y + punto],
        fill=blanco,
    )


def centrado(dibujo: ImageDraw.ImageDraw, texto: str, y: int, fuente_texto) -> None:
    caja = dibujo.textbbox((0, 0), texto, font=fuente_texto)
    ancho = caja[2] - caja[0]
    dibujo.text(((ANCHO - ancho) / 2 - caja[0], y), texto, font=fuente_texto, fill=(255, 255, 255))


def main() -> None:
    img = degradado()
    dibujo = ImageDraw.Draw(img)

    logo(dibujo, ANCHO // 2, 118)

    # Todo centrado: Play recorta los lados en cuanto la tarjeta es más estrecha
    # que 1024, que es casi siempre, y lo que sobrevive es el centro.
    centrado(dibujo, "OrbitHub", 205, fuente(FUENTES, 88))
    centrado(dibujo, "Listas  ·  Notas  ·  Catálogo", 316, fuente(FUENTES_CURSIVA, 38))
    centrado(
        dibujo,
        "Espacios   Películas   Series   Libros   Funciona sin conexión",
        392,
        fuente(FUENTES_PIE, 24),
    )

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    img.save(DESTINO, format="PNG", optimize=True)
    kb = DESTINO.stat().st_size / 1024
    print(f"[brand] {DESTINO}  {ANCHO}x{ALTO}  {kb:.1f} KB")


if __name__ == "__main__":
    main()