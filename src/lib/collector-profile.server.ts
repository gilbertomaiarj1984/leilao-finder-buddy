/**
 * (Sem cache: é lida uma vez por LOTE de lotes avaliados e são tabelas pequenas — assim um disco
 * recém-colocado no De olho já vale na próxima avaliação.)
 *
 * Leitura do perfil do colecionador (interesses + De olho + Coleção) para a avaliação da IA.
 * Best-effort: qualquer falha devolve `null` e o bloco simplesmente não entra no prompt.
 */
import { buildProfileContext, type ProfileContext } from "./collector-profile";

export async function loadProfileContext(): Promise<ProfileContext | null> {
  try {
    const [{ getUserInterests, getAnalyticsAliases, getCollectionKeywordDenylist }, lookout, coll] =
      await Promise.all([
        import("./app-state.server"),
        import("./lookout.server"),
        import("./collection.server"),
      ]);
    const [interests, aliases, denylist, items, links, collection] = await Promise.all([
      getUserInterests(),
      getAnalyticsAliases(),
      getCollectionKeywordDenylist(),
      lookout.getAllLookout(),
      lookout.getLookoutLinks(),
      coll.getAllCollection(),
    ]);
    return buildProfileContext({
      interests,
      lookout: items,
      lookoutLinks: links,
      collection,
      ownedDenylist: denylist,
      artistAliases: aliases.artists,
    });
  } catch (error) {
    console.error("[collector-profile] falha ao ler o perfil; seguindo sem ele", error);
    return null;
  }
}
