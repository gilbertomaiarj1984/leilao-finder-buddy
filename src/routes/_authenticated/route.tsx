import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";

import { MobileBottomNav } from "@/components/vinyl/mobile/mobile-bottom-nav";
import { getSessionEmail } from "@/lib/auth.functions";
import { useIsMobile } from "@/lib/use-is-mobile";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { email } = await getSessionEmail();
    if (!email) throw redirect({ to: "/auth" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  // Celular: barra inferior fixa (Dias, Vigiados, Lances, Menu) em todas as telas logadas. No
  // desktop e no HTML do servidor nada muda (`useIsMobile` começa `false`).
  const mobile = useIsMobile();
  return (
    <>
      <Outlet />
      {mobile ? <MobileBottomNav /> : null}
    </>
  );
}
