/**
 * The two legal documents, as data.
 *
 * They are here and not in the screens because they are prose that will change —
 * reviewed, corrected, rewritten — and a rewrite of a legal document should not
 * be a diff against a React component. The screens are two thin routes that hand
 * this to `LegalDocument`.
 *
 * ## This is a skeleton, and it has not been through anybody who does this
 *
 * Every factual claim below is checked against the code: the Argon2id hash, the
 * `accepted_terms_at` written at sign-up, the catalogues, the four processors.
 * Everything a *decision* requires is not filled in, and filling it in is the
 * point of the following list. Do not point a store at this URL before they are
 * answered — a privacy policy that is wrong is worse than one that is missing,
 * and it is the kind of wrong that is only found by somebody asking.
 *
 *   1. Who the data controller is. "OrbitHub" is a product name, not a legal
 *      entity, and the pages have to name a person or a company.
 *   2. The contact address. The transactional sender is `no-reply@...`, which is
 *      the one address nobody reads.
 *   3. Retention. The schema has `deleted_at`, so a deletion path is expected;
 *      how long a deleted account's rows stay is a number, not a paragraph.
 *   4. Legal basis per purpose, and whether the transfers to the processors
 *      listed under *Sharing* need a transfer clause.
 *   5. The governing law and the courts, for the terms.
 *   6. Whether these are one document or two. They are two routes, and the two
 *      texts overlap on deletion and on who owns the content.
 *
 * ## Spanish only, on purpose
 *
 * The app translates its interface into Spanish and English, and these documents
 * do not. A privacy policy has to be legible to the authority that reads it and
 * to the person whose data it is about, and a second language here is a second
 * thing to keep honest: two pages that can disagree about what is stored. The
 * English one is its own route (`/privacy/en`) and its own review.
 *
 * So the labels inside a document are in this file, in Spanish, and only what
 * the interface draws around them — the route title in the header, the rows in
 * settings, the notice under the sign-up box — goes through `t()`.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocumentData {
  /** The label above the date. In the document's language, not the app's. */
  updatedLabel: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
}

export const LEGAL_PRIVACY: LegalDocumentData = {
  updatedLabel: 'Última revisión',
  updatedAt: '1 de octubre de 2026',
  intro:
    'Esta política explica qué datos guarda OrbitHub, por qué los guarda y qué puedes hacer con ellos. Se escribe en los términos en que funciona el producto: si algo aquí no coincide con lo que hace la aplicación, es un fallo de esta página y hay que corregirlo.',
  sections: [
    {
      heading: 'El responsable',
      paragraphs: [
        'OrbitHub es una aplicación para organizar espacios de trabajo, listas, notas y tareas, disponible en Android, iOS y web con la misma cuenta.',
        'El responsable del tratamiento es JRZ Labs. Puedes escribir a privacy@jrzlabs.com para cualquier cosa relacionada con tus datos.',
        'Si la ley de tu país te obliga a saber un domicilio físico del responsable, escríbenos y te lo enviamos. No lo publicamos aquí porque es un dato que cambia y esta página no se actualiza a menudo.',
      ],
    },
    {
      heading: 'Qué datos guardamos',
      paragraphs: [
        'Los datos de la cuenta: el correo con el que te registras, el nombre que eliges mostrar, el idioma de la interfaz, y una marca de que verificaste ese correo. La contraseña no se guarda nunca: se guarda su huella Argon2id, y con esa huella no se puede volver a iniciar sesión porque la contraseña original no está en ninguna parte.',
        'El contenido que creas: los espacios, las listas, las tareas, las notas y las plantillas que escribes, los archivos que adjuntas a una nota, y con quién compartes cada cosa. Las invitaciones de un espacio son la lista de correos concretos que esa persona decide invitar, no las personas que tiene en su agenda.',
        'Un dato de acceso: la fecha y hora del último uso, y la lista de dispositivos con sesión abierta, para que puedas cerrarlas desde los ajustes.',
        'El momento en que aceptaste los términos y la privacidad. Sin eso no se puede demostrar que aceptaste, y por eso se guarda al crear la cuenta y no en un archivo que se pueda editar después.',
      ],
    },
    {
      heading: 'Dónde se guardan',
      paragraphs: [
        'En el servidor de OrbitHub, en una base de datos PostgreSQL. Los archivos adjuntos van a almacenamiento de objetos y se entregan con una dirección temporal: la dirección de una imagen caduca, y sin caducidad sería una dirección que cualquiera que la tuviera podría usar para siempre.',
        'En tu dispositivo, además. La aplicación funciona sin conexión: una copia de lo que ves está en el almacenamiento local del teléfono o del navegador, y lo que escribes se guarda primero ahí y se sincroniza después. Por eso los datos de una cuenta no desaparecen de tu dispositivo cuando los borras del servidor.',
      ],
    },
    {
      heading: 'Con quién se comparten',
      paragraphs: [
        'Con los proveedores que hacen funcionar el servicio, y solo para eso. Estos son todos, con un enlace a sus condiciones:',
        '• Railway, que aloja el servidor y la base de datos PostgreSQL. Solo recibe tus datos porque es quien los guarda. Sus condiciones están en https://railway.com/legal/terms',
        '• Resend, que envía el correo de verificación y el de las invitaciones. Cada correo sale con tu dirección en el campo Para. Sus condiciones están en https://resend.com/legal',
        '• Amazon S3 o Cloudflare R2, que guardan los archivos que adjuntas a una nota. Tus condiciones están en https://aws.amazon.com/legal y https://www.cloudflare.com/terms',
        'Con Google si te validas con una cuenta de Google, y con TMDB y con Google Books si buscas películas, series o libros en el catálogo. Una búsqueda del catálogo envía el título que escribes a esos servicios para que puedan responder; no se les envía tu cuenta ni el contenido de tus notas.',
        'Con nadie más. No vendemos los datos, no se usan para publicidad, y no se comparten con terceros para sus propios fines.',
        'Todos estos proveedores pueden tratar datos fuera del Espacio Económico Europeo. Lo hacen con sus propias garantías, como los acuerdos de marco de protección de datos de la Comisión Europea o los marcos de privacidad de datos de Estados Unidos. Puedes escribirnos y te explicamos qué garantía cubre tu caso, o borrar la cuenta y que no quede nada en ningún sitio.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'La aplicación web no pone cookies de seguimiento ni de publicidad. Guarda lo mínimo para mantener la sesión iniciada, y ese dato se queda en tu navegador: es lo que permite que al volver a abrir la página no tengas que escribir la contraseña otra vez. No hay banner de consentimiento porque no hay nada que consentir.',
      ],
    },
    {
      heading: 'Tus derechos',
      paragraphs: [
        'Puedes saber qué datos tuyos tenemos, corregirlos, pedir que se borre la cuenta, y llevarte una copia. También puedes oponerte a un uso concreto o retirar un consentimiento.',
        'Para ejercerlos basta con escribir a privacy@jrzlabs.com. Respondemos en un máximo de 30 días, y normalmente en dos o tres. Y no tienen por qué ser un correo: casi todos se resuelven desde la propia aplicación, que es más rápido que leer un correo y más difícil de malinterpretar.',
        'Si no quedas satisfecho con la respuesta, puedes reclamar ante la Agencia Española de Protección de Datos.',
      ],
    },
    {
      heading: 'Seguridad',
      paragraphs: [
        'Las contraseñas se guardan como huellas Argon2id. Las sesiones se identifican con un token que el cliente guarda en el almacén seguro del sistema, no en el código de la aplicación. Las comprobaciones de propiedad y de rol están en el servidor: la aplicación no es una frontera de seguridad, y ninguna decisión de autorización se toma en el dispositivo.',
      ],
    },
    {
      heading: 'Cambios',
      paragraphs: [
        'Si esta política cambia de forma que afecte a tus datos, se publicará en esta misma página con la fecha de revisión de arriba actualizada. Los cambios que reduzcan lo que se recoge o lo que se comparte no se aplicarán a tus datos sin avisarte antes.',
      ],
    },
  ],
};

export const LEGAL_TERMS: LegalDocumentData = {
  updatedLabel: 'Última revisión',
  updatedAt: '1 de octubre de 2026',
  intro:
    'Estas condiciones son el acuerdo entre OrbitHub y quien usa la aplicación. Si aceptas crear una cuenta, aceptas estas condiciones y la política de privacidad.',
  sections: [
    {
      heading: 'Qué es OrbitHub',
      paragraphs: [
        'Una aplicación para organizar espacios de trabajo, listas, notas y tareas, disponible en Android, iOS y web. Funciona con conexión, guarda una copia local para poder usarse sin ella, y sincroniza cuando vuelve a haberla.',
        'El servicio se ofrece tal cual. No garantizamos que esté disponible todo el tiempo ni que una actualización no cambie el comportamiento de una función de la que dependas.',
      ],
    },
    {
      heading: 'La cuenta',
      paragraphs: [
        'Para usar la aplicación hace falta una cuenta. Elige una contraseña que no uses en otro sitio, y no compartas la cuenta: una cuenta compartida es una forma de que alguien acceda a lo que es tuyo y no hay forma de saber después quién fue.',
        'Puedes cerrar tu cuenta cuando quieras. Cerrarla borra tu contenido del servidor; la copia que queda en tu dispositivo depende de ti, y por eso es importante tener en cuenta que borrar la cuenta en el servidor no borra nada de tu teléfono ni de tu navegador.',
      ],
    },
    {
      heading: 'Tu contenido',
      paragraphs: [
        'Lo que escribes sigue siendo tuyo. Puedes leerlo, cambiarlo, compartirlo y borrarlo cuando quieras, y OrbitHub no lo usa para nada más.',
        'Al invitar a alguien a un espacio le das acceso a lo que haya en ese espacio. El nombre al que se manda la invitación lo ve la persona invitada en su correo, así que solo invita a quien quieras que sepa que estás en OrbitHub.',
        'Nos das permiso para almacenar y mostrar lo que nos envías para que la aplicación funcione. Ese permiso no incluye revendértelo ni usarlo para entrenar nada.',
      ],
    },
    {
      heading: 'Uso aceptable',
      paragraphs: [
        'No uses la aplicación para guardar algo ilegal, ni para acosar a nadie, ni para enviar spam. El contenido que otros usuarios pueden ver tiene que ser contenido que puedas enseñar.',
        'No intentes entrar en cuentas ajenas, ni eludir los límites del servicio, ni reclamar como tuyo lo que es de otra persona para juntarlo con lo tuyo.',
      ],
    },
    {
      heading: 'Suspensión',
      paragraphs: [
        'Podemos suspender o cerrar una cuenta que esté rompiendo estas condiciones, y en general solo después de avisar y de darle una oportunidad de explicarse.',
        'Una cuenta suspendida por incumplimiento confirmado puede cerrarse sin más aviso.',
      ],
    },
    {
      heading: 'Responsabilidad',
      paragraphs: [
        'OrbitHub se ofrece tal cual y sin garantías. En la medida en que la ley lo permita, la responsabilidad por daños derivados del uso del servicio está limitada al importe que hayas pagado por él, que hasta ahora es cero.',
        'Esta limitación no se aplica a dolo, a daño causado deliberadamente, ni a lo que no pueda limitarse por ley.',
      ],
    },
    {
      heading: 'Cambios en estas condiciones',
      paragraphs: [
        'Podemos cambiar estas condiciones. Si el cambio es importante, se avisará en la aplicación o por correo antes de que entre en vigor, y en esta página se actualizará la fecha de revisión de arriba.',
        'Seguir usando la aplicación después de que un cambio entre en vigor significa que lo aceptas.',
      ],
    },
    {
      heading: 'Ley aplicable',
      paragraphs: [
        'Estas condiciones se rigen por la ley española. Para cualquier controversia son competentes los tribunales de Madrid, porque es donde está el responsable.',
        'Si estás en otro país, esto no te quita el derecho a usar la protección de tu consumidor local.',
      ],
    },
  ],
};