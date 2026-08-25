// As novas API keys do Supabase (`sb_publishable_…` / `sb_secret_…`) são strings
// opacas, não JWTs bearer. O supabase-js ainda manda `Authorization: Bearer <key>`
// por padrão; este wrapper remove esse header nesse caso e envia a chave só em
// `apikey`. Compartilhado pelos clientes (browser/admin) e pelo middleware de auth.

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}
