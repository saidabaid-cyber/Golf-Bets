/** OTP errors are not an account directory. Even otp_disabled is ambiguous.
 * Only an authenticated, verified account mapping can assert account absence. */
export function emailLoginRecovery(verifiedAccountMissing = false) {
  return verifiedAccountMissing
    ? "No tienes una cuenta todavía. ¿Quieres crearla?"
    : "No pudimos iniciar sesión. Si todavía no tienes cuenta, puedes crearla";
}
