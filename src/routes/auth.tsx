import { createFileRoute } from "@tanstack/react-router";
import { Disc3 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Garimpo de Vinil" },
      {
        name: "description",
        content: "Acesso restrito ao Garimpo de Vinil: entre com a conta Google autorizada.",
      },
      { property: "og:title", content: "Entrar — Garimpo de Vinil" },
      {
        property: "og:description",
        content: "Acesso restrito: apenas a conta Google cadastrada nas casas de leilão.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

// O login em si é uma navegação de página inteira para /api/auth/google/start
// (tratado direto em server.ts, fora das server functions — ver auth.server.ts),
// que redireciona pro Google e volta em /api/auth/google/callback com a sessão
// já em cookie. Não há mais PKCE/exchange no cliente (era feito pelo supabase-js).
function AuthPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const err = url.searchParams.get("error");
    if (err) {
      setError("Não foi possível entrar com o Google. Tente novamente.");
      window.history.replaceState({}, "", url.pathname);
    }
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <Disc3 className="mx-auto h-10 w-10 text-primary" />
        <p className="mt-4 text-xs uppercase tracking-[0.35em] text-primary">LeilõesBR</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Garimpo de Vinil</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Acesso restrito. Entre com a conta Google do mesmo e-mail cadastrado nas casas de leilão.
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => {
            window.location.href = "/api/auth/google/start";
          }}
        >
          Entrar com Google
        </Button>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>
    </main>
  );
}
