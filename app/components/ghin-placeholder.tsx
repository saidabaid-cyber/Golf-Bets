export function GhinPlaceholder({ authenticated = false }: { authenticated?: boolean }) {
  return <p role="status">{authenticated
    ? "GHIN no está disponible en este entorno."
    : "Inicia sesión para vincular tu cuenta GHIN. La integración permanece disponible sólo en dev/Preview."}</p>;
}
