import { Search as SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Caixa de busca isolada num componente próprio: o rascunho digitado (`draft`) fica em estado
// local, então cada tecla só re-renderiza esta caixa — não a árvore inteira de `RouteComponent`
// (que é pesada, com centenas de lotes) — evitando o travamento ao digitar. A busca de fato só
// é aplicada (via `onSearch`) no Enter ou no clique do botão.
export function LotSearchBox({
  committed,
  onSearch,
  onClear,
}: {
  committed: string;
  onSearch: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(committed);
  // A busca confirmada pode ser restaurada do armazenamento local após a montagem.
  useEffect(() => setDraft(committed), [committed]);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSearch(draft);
          }
        }}
        placeholder="Buscar título, artista, casa ou nº do lote…"
        className="h-7 w-[200px] text-xs sm:w-56"
      />
      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => onSearch(draft)}>
        <SearchIcon className="mr-1 h-3.5 w-3.5" />
        Pesquisar
      </Button>
      {committed || draft ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => {
            setDraft("");
            onClear();
          }}
        >
          Limpar busca
        </Button>
      ) : null}
    </div>
  );
}
