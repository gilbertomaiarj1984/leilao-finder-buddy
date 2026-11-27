// Agrupamento de álbuns de UM artista com ajuda da IA (Analytics). Módulo PURO: monta o pedido,
// valida a resposta e aplica as regras de segurança ("na dúvida, não funde"). Quem chama a IA é
// `album-grouping.server.ts`; quem grava é a tela, só depois do clique do usuário.
import { foldPlural } from "./analytics";
import { normalizeForMatch } from "./vinyl-parse";

/** Álbum (já agrupado pela chave atual do Analytics) que entra no pedido. */
export type GroupingAlbum = {
  /** Chave estável do álbum no Analytics (`AlbumAgg.key`). */
  key: string;
  name: string;
  count: number;
  /** Um título original de exemplo (ajuda a IA a ver a edição/gravadora). */
  sample?: string;
};

export type AlbumGroup = {
  /** Nome canônico — SEMPRE um dos nomes de álbum já existentes no grupo. */
  name: string;
  keys: string[];
  /** Avisos para o usuário conferir (ex.: ao vivo misturado com estúdio). */
  warnings: string[];
};

export const MAX_GROUPING_ALBUMS = 120;

export const ALBUM_GROUPING_SYSTEM = `Você organiza o catálogo de discos de vinil de UM artista brasileiro.
Recebe uma lista numerada de nomes de álbum (podem ser o mesmo disco escrito de formas diferentes:
acento faltando, artigo "A/O", subtítulo entre parênteses, gravadora, código, "C/ ENCARTE", "capa dupla", ano).
Tarefa: agrupar SÓ os itens que são o MESMO disco (mesmo título, mesma obra).
REGRAS (na dúvida, NÃO agrupe — separar por engano é barato, juntar por engano estraga o preço médio):
- Números diferentes são discos diferentes (Vol. 1 ≠ Vol. 2; "Clube da Esquina" ≠ "Clube da Esquina 2").
- Estúdio ≠ ao vivo ("Circuladô" ≠ "Circuladô Vivo"). Coletânea/"O Melhor de" ≠ álbum original.
- Disco homônimo do artista ≠ outro álbum cujo título só contém o nome dele.
- Título que lista dois discos ("A / B") não entra em nenhum grupo.
- Ignore diferenças de acento, caixa, artigo inicial, gravadora, código, estado de conservação, ano.
- O nome do grupo deve ser COPIADO de um dos itens do grupo (o mais limpo), nunca inventado.
- Cada item entra em NO MÁXIMO um grupo. Itens sozinhos não aparecem na resposta.
Responda SÓ JSON: {"groups":[{"name":"<nome copiado de um item>","items":[1,5,7]}]}`;

/** Texto do pedido: lista numerada (1..N) — a IA responde com os números, nunca reescreve chaves. */
export function buildAlbumGroupingText(artist: string, albums: GroupingAlbum[]): string {
  const lines = albums.map((a, i) => {
    const sample =
      a.sample && normalizeForMatch(a.sample) !== normalizeForMatch(a.name) ? a.sample : "";
    return `${i + 1}. ${a.name} (${a.count} venda${a.count === 1 ? "" : "s"})${
      sample ? ` — título original: ${sample.slice(0, 110)}` : ""
    }`;
  });
  return `Artista: ${artist}\nÁlbuns:\n${lines.join("\n")}`;
}

/** Números que identificam a edição ("Vol. 2", "2", "Vol III"): diferentes ⇒ discos diferentes. */
function editionNumbers(name: string): string {
  const key = normalizeForMatch(name);
  const nums = key.match(/\b\d+\b/g) ?? [];
  const romans = key.match(/\b(ii|iii|iv|vi|vii|viii|ix)\b/g) ?? [];
  return [...nums, ...romans].sort().join(",");
}

function isLive(name: string): boolean {
  return /\b(ao vivo|vivo|live|acustico|unplugged)\b/.test(normalizeForMatch(name));
}

function isCompilationName(name: string): boolean {
  return /\b(melhor|sucessos|antologia|colet[aâ]nea|greatest|best of)\b/.test(
    normalizeForMatch(name),
  );
}

/**
 * Valida a resposta da IA contra os álbuns enviados. Regras DURAS (descarta o grupo): itens
 * inválidos/repetidos, menos de 2 membros, números de edição diferentes entre membros. Regras
 * BRANDAS (mantém, mas avisa e a tela não pré-seleciona): ao vivo × estúdio, coletânea × álbum.
 * O nome canônico é forçado a ser um dos nomes dos membros (a IA não inventa título).
 */
export function validateAlbumGroups(
  raw: Record<string, unknown> | null,
  albums: GroupingAlbum[],
): AlbumGroup[] {
  const list = raw && Array.isArray(raw["groups"]) ? (raw["groups"] as unknown[]) : [];
  const used = new Set<number>();
  const out: AlbumGroup[] = [];
  for (const g of list) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const items = Array.isArray(obj["items"]) ? (obj["items"] as unknown[]) : [];
    const idx: number[] = [];
    for (const it of items) {
      const n = typeof it === "number" ? it : Number(it);
      if (!Number.isInteger(n) || n < 1 || n > albums.length) continue;
      if (used.has(n) || idx.includes(n)) continue;
      idx.push(n);
    }
    if (idx.length < 2) continue;
    const members = idx.map((n) => albums[n - 1]!);
    // Dois membros que o Analytics já trata como o mesmo disco nem entram (nada a fazer).
    const distinctKeys = new Set(members.map((m) => foldPlural(m.key)));
    if (distinctKeys.size < 2) continue;
    if (new Set(members.map((m) => editionNumbers(m.name))).size > 1) continue;
    const warnings: string[] = [];
    if (new Set(members.map((m) => isLive(m.name))).size > 1) {
      warnings.push("mistura ao vivo com estúdio — confira");
    }
    if (new Set(members.map((m) => isCompilationName(m.name))).size > 1) {
      warnings.push("mistura coletânea com álbum — confira");
    }
    // Nome canônico: o sugerido, se for mesmo um dos nomes; senão o de mais vendas.
    const wanted = typeof obj["name"] === "string" ? normalizeForMatch(obj["name"]) : "";
    const byCount = [...members].sort((a, b) => b.count - a.count);
    const canon = members.find((m) => normalizeForMatch(m.name) === wanted) ?? byCount[0]!;
    for (const n of idx) used.add(n);
    out.push({ name: canon.name, keys: members.map((m) => m.key), warnings });
  }
  return out;
}
