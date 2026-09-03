// Fonte única da versão do app. **Bump aqui em TODO PR** (obrigatório — o CI
// `version-bump.yml` falha o PR se este número não subir) e use-o no título do
// PR (ex.: "v0.2.0 — ...").
//
// Convenção (semver): MAJOR.MINOR.PATCH
// - PATCH: correções de bug e ajustes pequenos
// - MINOR: novas funcionalidades compatíveis
// - MAJOR: mudanças incompatíveis
//
// O rodapé (`src/components/Footer.tsx`) lê esta constante e a exibe em todas
// as telas, para acompanhar em produção qual versão está no ar.
export const APP_VERSION = "0.14.0";
