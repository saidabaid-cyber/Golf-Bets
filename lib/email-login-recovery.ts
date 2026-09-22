/** OTP errors are not an account directory. Even otp_disabled is ambiguous.
 * Only an authenticated, verified account mapping can assert account absence. */
export function emailLoginRecovery(verifiedAccountMissing = false) {
  return verifiedAccountMissing
    ? "No tienes cuenta. ¿Quieres crear una?"
    : "No pudimos iniciar sesión. No tienes cuenta. ¿Quieres crear una?";
}
