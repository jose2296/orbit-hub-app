export type UrlCompartida = {
  url: string;
  resto: string;
};

// Saca la primera URL de un texto compartido y deja el resto como titulo
// posible. Funcion pura a proposito: no toca nativo y se prueba sin movil.
export function sacarUrlDelTexto(texto: string): UrlCompartida | null {
  const hallada = /https?:\/\/[^\s]+/.exec(texto);
  if (!hallada) return null;
  // El dedo suele arrastrar el punto o la coma que cierra la frase.
  const url = hallada[0].replace(/[.,;:!?)\]]+$/u, '');
  const resto = texto.replace(hallada[0], '').trim().replace(/\s+/gu, ' ');
  return { url, resto };
}
