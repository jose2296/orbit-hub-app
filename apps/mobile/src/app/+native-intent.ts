import { getSharedPayloads } from 'expo-sharing';

// El import de arriba ata el modulo nativo al arranque en frio, pero no se
// llama aqui a proposito: si el redirect leyera el payload, el arranque en
// frio lo perderia por carrera. La lectura es de la ruta (share/save).
void getSharedPayloads;

export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  void initial;
  try {
    // Una ruta interna (empieza por /) no es un intent del sistema: pasa tal
    // cual. `new URL` la tiraria al catch porque no es absoluta.
    if (path.startsWith('/')) return path;
    if (new URL(path).hostname === 'expo-sharing') return '/share/save';
    return path;
  } catch {
    return '/';
  }
}
