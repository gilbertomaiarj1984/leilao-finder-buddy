import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";

import { getSessionEmail } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { email } = await getSessionEmail();
    if (!email) throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});
