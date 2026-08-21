import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Disc3, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

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

function AuthPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) void router.navigate({ to: "/", replace: true });
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function signIn() {
    setBusy(true);
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setError("Não foi possível entrar com o Google. Tente novamente.");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    await router.navigate({ to: "/", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <Disc3 className="mx-auto h-10 w-10 text-primary" />
        <p className="mt-4 text-xs uppercase tracking-[0.35em] text-primary">LeilõesBR</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Garimpo de Vinil</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Acesso restrito. Entre com a conta Google do mesmo e-mail cadastrado nas casas de leilão.
        </p>
        <Button className="mt-6 w-full" onClick={() => void signIn()} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Entrar com Google
        </Button>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>
    </main>
  );
}
