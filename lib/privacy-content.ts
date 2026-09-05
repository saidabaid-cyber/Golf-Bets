export const PRIVACY_LEGAL_VERSION = "2026-09-02-v2";
export const PRIVACY_EFFECTIVE_DATE = "2 de septiembre de 2026";

// The legal version was already used by a different draft in this repository.
// Consent evidence therefore uses a content-specific id while the published
// legal version and effective date remain exactly as approved.
export const PRIVACY_CONTENT_ID = "2026-09-02-v2+sha256-af74adf0fb7bb96e";

export const PRIVACY_INTRO = "Este Aviso describe el tratamiento de datos personales conforme al estado actual de The Backyard.";

export const PRIVACY_SECTIONS = [
  {
    number: 1,
    title: "Identidad y domicilio del responsable",
    paragraphs: [
      "Responsable: Said Abaid Taja",
      "Domicilio: Calle 1 Retorno Osa Menor, Número Exterior 2, Interior 1003, Colonia Reserva Territorial Atlixcáyotl, Localidad San Bernardino Tlaxcalancingo, Municipio San Andrés Cholula, Puebla, C.P. 72820, México. Referencia: Periférico Ecológico.",
      "Contacto de privacidad y ARCO: privacidad@thebackyard.com.mx",
      "El responsable tratará los datos personales conforme a la legislación mexicana aplicable y a este Aviso.",
    ],
  },
  {
    number: 2,
    title: "Datos personales que podemos tratar",
    paragraphs: [
      "Según las funciones que decidas utilizar, podemos tratar nombre; correo electrónico; proveedor de acceso; avatar o fotografía de perfil si la proporcionas; HCP; scores; campos; rondas e histórico; torneos y grupos; información de Polla Live; apuestas registradas, resultados y gastos; rivales; fotografías de scorecards cuando las agregas; consultas de reglas y el texto enviado a la IA; preferencias; datos técnicos estrictamente necesarios (como dirección IP, identificadores de dispositivo y navegador, y registros de acceso); información de sesión, sincronización y seguridad.",
      "Los datos relativos a apuestas registradas, resultados y gastos pueden tener el carácter de datos financieros o patrimoniales, por lo que su tratamiento requiere tu consentimiento expreso. Dicho consentimiento se recabará mediante una manifestación afirmativa (casilla de aceptación no premarcada) al activar por primera vez Polla Live o el registro de apuestas.",
      "La versión actual no solicita ubicación precisa. Si una función futura la necesitara, se informaría su finalidad y se solicitaría el permiso correspondiente.",
    ],
  },
  {
    number: 3,
    title: "Datos sensibles",
    paragraphs: [
      "No solicitamos deliberadamente datos personales sensibles. El HCP y los datos deportivos no se tratan como datos sensibles. Te pedimos no incluir información sensible ni datos innecesarios en campos libres o consultas a la IA.",
    ],
  },
  {
    number: 4,
    title: "Finalidades primarias",
    paragraphs: [
      "Usamos los datos necesarios para crear y autenticar una cuenta; mantener perfiles; administrar rondas, campos y grupos; calcular y liquidar matemáticamente resultados; conservar el histórico elegido; ofrecer reglas y consultas mediante IA; habilitar sincronización cuando la nube esté activa; operar Polla Live; brindar soporte; proteger cuentas y prevenir abuso. Las finalidades descritas en este apartado son necesarias para la existencia, mantenimiento y cumplimiento de la relación jurídica entre el titular y el responsable, por lo que no requieren tu consentimiento adicional. Cualquier finalidad distinta de las previstas en este Aviso requerirá recabar nuevamente tu consentimiento.",
    ],
  },
  {
    number: 5,
    title: "Finalidades secundarias",
    paragraphs: [
      "Actualmente no usamos tus datos para publicidad o mercadotecnia. Si se incorporaran comunicaciones promocionales, se ofrecería una elección separada y un mecanismo para retirarla.",
    ],
  },
  {
    number: 6,
    title: "Proveedores y transferencias",
    paragraphs: [
      "Para prestar determinadas funciones podemos apoyarnos en encargados o proveedores tecnológicos como Vercel (alojamiento), Supabase (autenticación y datos en nube), OpenAI (procesamiento de consultas al asistente de reglas) y Google (autenticación cuando el usuario elige ese método). La información compartida se limita a la necesaria para la función solicitada. Con estos proveedores hemos celebrado o aceptado términos que los obligan a tratar los datos personales únicamente conforme a nuestras instrucciones, con fines limitados a la función solicitada y con medidas de seguridad adecuadas. El procesamiento puede realizarse en servidores ubicados fuera de México.",
      "Las transferencias o comunicaciones de datos se realizarán cuando sean necesarias para las finalidades descritas, exista una relación con un encargado, lo requiera una autoridad competente o exista otra base jurídica aplicable.",
    ],
  },
  {
    number: 7,
    title: "Inteligencia artificial",
    paragraphs: [
      "Al usar “Preguntar a IA”, el texto de tu consulta y el contexto de reglas estrictamente necesario pueden enviarse al proveedor de IA para generar una respuesta. No enviamos intencionalmente el histórico completo, apuestas privadas ni información personal que no sea necesaria. Evita escribir datos personales de terceros.",
    ],
  },
  {
    number: 8,
    title: "Cookies, sesión y almacenamiento local",
    paragraphs: [
      "La aplicación utiliza almacenamiento del navegador, incluido localStorage e IndexedDB cuando corresponde, para autosave, ronda e histórico local, jugadores, grupos, preferencias, fotografías y consentimientos de invitado. Supabase puede usar almacenamiento o cookies estrictamente técnicas para conservar la sesión. No utilizamos cookies publicitarias en esta versión.",
    ],
  },
  {
    number: 9,
    title: "Conservación y eliminación",
    paragraphs: [
      "Conservamos los datos mientras sean necesarios para prestar las funciones solicitadas, mantener el histórico elegido por el usuario, atender obligaciones legales, seguridad o controversias. Los datos locales permanecen en el dispositivo hasta que el usuario los elimina, borra el almacenamiento del navegador o desinstala los datos de la PWA. Cuando la nube esté activa, podrán solicitarse la eliminación de cuenta y datos, sujeto a obligaciones legales de conservación.",
    ],
  },
  {
    number: 10,
    title: "Limitación del uso y divulgación",
    paragraphs: [
      "Puedes solicitar la limitación del uso o divulgación escribiendo a privacidad@thebackyard.com.mx, indicando tu nombre, medio para recibir respuesta, la cuenta relacionada y el alcance de la solicitud.",
    ],
  },
  {
    number: 11,
    title: "Derechos ARCO",
    paragraphs: [
      "Puedes solicitar Acceso a tus datos, Rectificación de datos inexactos, Cancelación cuando proceda u Oposición a determinados tratamientos. Envía la solicitud a privacidad@thebackyard.com.mx con: nombre, medio para comunicar la respuesta, descripción clara del derecho que deseas ejercer, datos involucrados y documentos razonables para acreditar identidad o representación. Comunicaremos la determinación adoptada en un plazo máximo de veinte días contados desde la recepción de la solicitud y, de resultar procedente, la haremos efectiva dentro de los quince días siguientes, conforme a la normativa aplicable.",
    ],
  },
  {
    number: 12,
    title: "Revocación del consentimiento",
    paragraphs: [
      "Puedes revocar un consentimiento cuando legalmente proceda escribiendo a privacidad@thebackyard.com.mx. Indica la cuenta relacionada, el consentimiento que deseas revocar y un medio para recibir respuesta. La revocación no tendrá efectos retroactivos y puede impedir prestar funciones que dependan del tratamiento.",
    ],
  },
  {
    number: 13,
    title: "Menores de edad",
    paragraphs: [
      "Las funciones relacionadas con apuestas están dirigidas exclusivamente a personas de 18 años o más. The Backyard no diseña deliberadamente esas funciones para menores ni procesa dinero de apuestas. El resto del servicio se dirige a personas mayores de edad; si una persona menor de edad utilizara la aplicación, el tratamiento de sus datos personales requerirá el consentimiento de quien ejerza la patria potestad o tutela.",
    ],
  },
  {
    number: 14,
    title: "Seguridad",
    paragraphs: [
      "Aplicamos medidas administrativas, técnicas y organizativas razonables según la naturaleza de los datos y la función utilizada. Ningún sistema puede prometer seguridad absoluta; por ello también debes proteger tu dispositivo, correo y métodos de acceso.",
    ],
  },
  {
    number: 15,
    title: "Cambios al Aviso",
    paragraphs: [
      "Las nuevas versiones se publicarán dentro de The Backyard. Cuando un cambio sea material o requiera nueva aceptación, la aplicación lo solicitará mediante una versión actualizada, sin pedirlo de nuevo mientras la versión aceptada siga vigente. Este Aviso se pondrá a disposición del titular de manera previa a la obtención de sus datos personales, mediante enlace visible en los formularios de registro correspondientes.",
    ],
  },
  {
    number: 16,
    title: "Contacto",
    paragraphs: [
      "Para privacidad, derechos ARCO o dudas sobre este Aviso: privacidad@thebackyard.com.mx. Para soporte operativo: soporte@thebackyard.com.mx.",
    ],
  },
] as const;

export function privacyPublishedPlainText() {
  const sections = PRIVACY_SECTIONS.flatMap((section) => [
    `${section.number}. ${section.title}`,
    ...section.paragraphs,
  ]);
  return [
    "THE BACKYARD",
    "Aviso de Privacidad Integral",
    `Versión ${PRIVACY_LEGAL_VERSION} · Vigente a partir del ${PRIVACY_EFFECTIVE_DATE}`,
    PRIVACY_INTRO,
    ...sections,
  ].join("\n\n");
}
