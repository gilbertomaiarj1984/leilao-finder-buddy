/** Só o e-mail cadastrado para as casas de leilão pode usar o app. */
export function allowedEmail(): string {
  const email = process.env["LEILOESBR_EMAIL"];
  if (!email) throw new Error("LEILOESBR_EMAIL não está configurado.");
  return email.trim().toLowerCase();
}

export function assertAllowed(email: string | undefined): void {
  const current = (email ?? "").trim().toLowerCase();
  if (!current || current !== allowedEmail()) {
    throw new Error("Esta conta Google não tem acesso ao Garimpo de Vinil.");
  }
}
