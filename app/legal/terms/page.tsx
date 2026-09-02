import Link from "next/link";
import { legalConfig } from "../../../lib/legal-config";

export const metadata = { title: "Términos de Uso · The Backyard" };

export default function TermsPage() {
  return <article className="legalDocument">
    <div className="eyebrow">THE BACKYARD</div>
    <h1>Términos de Uso</h1>
    <p className="legalVersion">Versión {legalConfig.termsVersion} · Vigentes a partir del {legalConfig.effectiveDate}</p>
    <p>Responsable: {legalConfig.responsibleName}. Contacto general: <a href={`mailto:${legalConfig.contactEmail}`}>{legalConfig.contactEmail}</a>.</p>

    <h2>1. Aceptación</h2><p>Al usar The Backyard aceptas estos Términos y el <Link href="/legal/privacy">Aviso de Privacidad</Link>. Si no estás de acuerdo, no utilices el servicio.</p>
    <h2>2. Cuenta de usuario</h2><p>La cuenta es personal. Debes proporcionar información razonablemente correcta, proteger tus métodos de acceso y avisar de usos no autorizados. También puedes usar el modo invitado, cuyos datos permanecen principalmente en ese dispositivo.</p>
    <h2>3. Edad</h2><p>Debes tener al menos 18 años para usar funciones relacionadas con apuestas. No uses esas funciones si la ley de tu ubicación las prohíbe o limita.</p>
    <h2>4. Uso permitido</h2><p>Puedes utilizar la aplicación para organizar juegos, registrar scores, calcular resultados, consultar reglas y mantener históricos propios o de grupos en los que participas. No debes usarla para fraude, suplantación, acceso no autorizado, daño al servicio o infracción de derechos.</p>
    <h2>5. Datos ingresados</h2><p>Eres responsable de los scores, HCP, participantes, montos y demás información que capturas. Los cálculos dependen de la exactitud y configuración de esos datos.</p>
    <h2>6. Apuestas entre participantes</h2><p>The Backyard es únicamente una herramienta para registrar, calcular, organizar y liquidar matemáticamente resultados entre jugadores. No recibe, custodia ni procesa dinero; no actúa como casa de apuestas, corredor o intermediario; no fija cuotas, intermedia fondos ni garantiza pagos. Las obligaciones económicas son acuerdos directos entre participantes. Cada usuario debe cumplir la legislación aplicable y puede decidir no usar estas funciones.</p>
    <h2 id="rules-referee">7. Reglas de Golf e IA</h2><p>El asistente de reglas usa las fuentes disponibles como herramienta de consulta. No es una autoridad ni árbitro oficial USGA. En una competencia formal, la decisión final corresponde al Comité o árbitro autorizado. Las respuestas pueden contener errores y deben revisarse con las fuentes citadas.</p>
    <h2>8. Reglas Locales</h2><p>Las Reglas Locales visibles son contenido controlado por el propietario o administrador de The Backyard. Se muestran únicamente para La Vista y La Vista Temporal. El club o Comité correspondiente conserva la autoridad sobre su adopción y vigencia oficial.</p>
    <h2>9. Exactitud y revisión</h2><p>Antes de pagar o cobrar, los participantes deben revisar tarjeta, participantes, HCP, valores y resultados. Las funciones de autosave y undo ayudan a recuperar capturas, pero no sustituyen esa revisión.</p>
    <h2>10. Disponibilidad</h2><p>Podemos mantener, modificar o interrumpir temporalmente funciones por seguridad, operación o cambios de proveedores. El modo local puede seguir disponible cuando una función de nube no esté configurada, sin garantía de disponibilidad ininterrumpida.</p>
    <h2>11. Propiedad intelectual</h2><p>The Backyard, su software, identidad y contenido propio están protegidos por la legislación aplicable. Las marcas, reglas y documentos de terceros pertenecen a sus titulares y se enlazan o usan conforme a sus permisos y condiciones.</p>
    <h2>12. Contenido del usuario</h2><p>Conservas los derechos sobre el contenido que aportas. Nos autorizas a tratarlo únicamente en la medida necesaria para ofrecer las funciones solicitadas. No subas contenido ilegal ni datos de terceros sin base legítima.</p>
    <h2>13. Conducta prohibida</h2><p>No intentes vulnerar seguridad, extraer secretos, automatizar abuso, alterar resultados ajenos, cargar malware, acosar, discriminar o usar la app para actividades ilícitas.</p>
    <h2>14. Suspensión o cancelación</h2><p>Podremos limitar una cuenta ante abuso, riesgo de seguridad o incumplimiento grave, procurando una medida proporcional. El usuario puede cerrar sesión y, cuando el backend esté habilitado, solicitar eliminación de cuenta y datos.</p>
    <h2>15. Responsabilidad</h2><p>En la medida permitida por la ley, el servicio se ofrece como herramienta de apoyo. No respondemos por acuerdos o pagos entre jugadores, decisiones oficiales de competencia, datos incorrectos capturados por usuarios ni consecuencias de usar una respuesta de IA sin revisión. Nada de esto limita derechos irrenunciables del consumidor ni responsabilidad que legalmente no pueda excluirse.</p>
    <h2>16. Cambios</h2><p>Podemos actualizar estos Términos. Publicaremos la versión vigente y solicitaremos nueva aceptación cuando el cambio lo requiera.</p>
    <h2>17. Privacidad</h2><p>El tratamiento de datos se describe en el <Link href="/legal/privacy">Aviso de Privacidad Integral</Link>.</p>
    <h2>18. Contacto</h2><p>Para preguntas generales: <a href={`mailto:${legalConfig.contactEmail}`}>{legalConfig.contactEmail}</a>. Para soporte: <a href={`mailto:${legalConfig.supportEmail}`}>{legalConfig.supportEmail}</a>. Para privacidad: <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>. Domicilio del responsable: {legalConfig.responsibleAddress}.</p>
  </article>;
}
