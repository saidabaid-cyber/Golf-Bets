import { legalConfig } from "../../../lib/legal-config";

export const metadata = { title: "Aviso de Privacidad Integral · The Backyard" };

export default function PrivacyPage() {
  return <article className="legalDocument">
    <div className="eyebrow">THE BACKYARD</div>
    <h1>Aviso de Privacidad Integral</h1>
    <p className="legalVersion">Versión {legalConfig.privacyVersion} · Vigente a partir del {legalConfig.effectiveDate}</p>
    <p>Este Aviso describe el tratamiento de datos personales conforme al estado actual de The Backyard. Su contenido no sustituye asesoría jurídica individual.</p>

    <h2>1. Identidad y domicilio del responsable</h2>
    <p><strong>Responsable:</strong> {legalConfig.responsibleName}<br /><strong>Domicilio:</strong> {legalConfig.responsibleAddress}<br /><strong>Contacto de privacidad y ARCO:</strong> <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a></p>
    <p>El responsable tratará los datos personales conforme a la legislación mexicana aplicable y a este Aviso.</p>

    <h2>2. Datos personales que podemos tratar</h2>
    <p>Según las funciones que decidas utilizar, podemos tratar nombre; correo electrónico; proveedor de acceso; avatar o fotografía de perfil si la proporcionas; HCP; scores; campos; rondas e histórico; torneos y grupos; información de Polla Live; apuestas registradas, resultados y gastos; rivales; fotografías de scorecards cuando las agregas; consultas de reglas y el texto enviado a la IA; preferencias; datos técnicos estrictamente necesarios; información de sesión, sincronización y seguridad.</p>
    <p>La versión actual no solicita ubicación precisa. Si una función futura la necesitara, se informaría su finalidad y se solicitaría el permiso correspondiente.</p>

    <h2>3. Datos sensibles</h2>
    <p>No solicitamos deliberadamente datos personales sensibles. El HCP y los datos deportivos no se tratan como datos sensibles. Te pedimos no incluir información sensible ni datos innecesarios en campos libres o consultas a la IA.</p>

    <h2>4. Finalidades primarias</h2>
    <p>Usamos los datos necesarios para crear y autenticar una cuenta; mantener perfiles; administrar rondas, campos y grupos; calcular y liquidar matemáticamente resultados; conservar el histórico elegido; ofrecer reglas y consultas mediante IA; habilitar sincronización cuando la nube esté activa; operar Polla Live; brindar soporte; proteger cuentas y prevenir abuso.</p>

    <h2>5. Finalidades secundarias</h2>
    <p>Actualmente no usamos tus datos para publicidad o mercadotecnia. Si se incorporaran comunicaciones promocionales, se ofrecería una elección separada y un mecanismo para retirarla.</p>

    <h2>6. Proveedores y transferencias</h2>
    <p>Para prestar determinadas funciones podemos apoyarnos en encargados o proveedores tecnológicos como Vercel (alojamiento), Supabase (autenticación y datos en nube), OpenAI (procesamiento de consultas al asistente de reglas) y Google (autenticación cuando el usuario elige ese método). La información compartida se limita a la necesaria para la función solicitada. Sus condiciones, ubicaciones de procesamiento y plazos pueden depender de la configuración y términos aplicables; no afirmamos condiciones contractuales o de retención que no hayan sido confirmadas.</p>
    <p>Las transferencias o comunicaciones de datos se realizarán cuando sean necesarias para las finalidades descritas, exista una relación con un encargado, lo requiera una autoridad competente o exista otra base jurídica aplicable.</p>

    <h2>7. Inteligencia artificial</h2>
    <p>Al usar “Preguntar a IA”, el texto de tu consulta y el contexto de reglas estrictamente necesario pueden enviarse al proveedor de IA para generar una respuesta. No enviamos intencionalmente el histórico completo, apuestas privadas ni información personal que no sea necesaria. Evita escribir datos personales de terceros.</p>

    <h2>8. Cookies, sesión y almacenamiento local</h2>
    <p>La aplicación utiliza almacenamiento del navegador, incluido localStorage e IndexedDB cuando corresponde, para autosave, ronda e histórico local, jugadores, grupos, preferencias, fotografías y consentimientos de invitado. Supabase puede usar almacenamiento o cookies estrictamente técnicas para conservar la sesión. No utilizamos cookies publicitarias en esta versión.</p>

    <h2>9. Conservación y eliminación</h2>
    <p>Conservamos los datos mientras sean necesarios para prestar las funciones solicitadas, mantener el histórico elegido por el usuario, atender obligaciones legales, seguridad o controversias. Los datos locales permanecen en el dispositivo hasta que el usuario los elimina, borra el almacenamiento del navegador o desinstala los datos de la PWA. Cuando la nube esté activa, podrán solicitarse la eliminación de cuenta y datos, sujeto a obligaciones legales de conservación.</p>

    <h2>10. Limitación del uso y divulgación</h2>
    <p>Puedes solicitar la limitación del uso o divulgación escribiendo a {legalConfig.privacyEmail}, indicando tu nombre, medio para recibir respuesta, la cuenta relacionada y el alcance de la solicitud.</p>

    <h2>11. Derechos ARCO</h2>
    <p>Puedes solicitar Acceso a tus datos, Rectificación de datos inexactos, Cancelación cuando proceda u Oposición a determinados tratamientos. Envía la solicitud a {legalConfig.privacyEmail} con: nombre, medio para comunicar la respuesta, descripción clara del derecho que deseas ejercer, datos involucrados y documentos razonables para acreditar identidad o representación. Informaremos el trámite, plazos y medios de respuesta conforme a la normativa aplicable.</p>

    <h2>12. Revocación del consentimiento</h2>
    <p>Puedes revocar un consentimiento cuando legalmente proceda escribiendo a {legalConfig.privacyEmail}. Indica la cuenta relacionada, el consentimiento que deseas revocar y un medio para recibir respuesta. La revocación no tendrá efectos retroactivos y puede impedir prestar funciones que dependan del tratamiento.</p>

    <h2>13. Menores de edad</h2>
    <p>Las funciones relacionadas con apuestas están dirigidas exclusivamente a personas de 18 años o más. The Backyard no diseña deliberadamente esas funciones para menores ni procesa dinero de apuestas.</p>

    <h2>14. Seguridad</h2>
    <p>Aplicamos medidas administrativas, técnicas y organizativas razonables según la naturaleza de los datos y la función utilizada. Ningún sistema puede prometer seguridad absoluta; por ello también debes proteger tu dispositivo, correo y métodos de acceso.</p>

    <h2>15. Cambios al Aviso</h2>
    <p>Las nuevas versiones se publicarán dentro de The Backyard. Cuando un cambio sea material o requiera nueva aceptación, la aplicación lo solicitará mediante una versión actualizada, sin pedirlo de nuevo mientras la versión aceptada siga vigente.</p>

    <h2>16. Contacto</h2>
    <p>Para privacidad, derechos ARCO o dudas sobre este Aviso: <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>. Para soporte operativo: <a href={`mailto:${legalConfig.supportEmail}`}>{legalConfig.supportEmail}</a>.</p>
  </article>;
}
