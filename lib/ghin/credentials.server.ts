import "server-only";

export type GhinServerCredentials = {
  login: string;
  password: string;
  loginBootstrapToken: string;
};

/** Reads credentials only inside the server graph. Never log or serialize this value. */
export function readGhinServerCredentials(
  env: Record<string, string | undefined>,
): GhinServerCredentials | null {
  const login = env.GHIN_TEST_LOGIN?.trim();
  const password = env.GHIN_TEST_PASSWORD;
  if (!login || !password) return null;
  return {
    login,
    password,
    loginBootstrapToken: env.GHIN_LOGIN_BOOTSTRAP_TOKEN?.trim() || "123",
  };
}
