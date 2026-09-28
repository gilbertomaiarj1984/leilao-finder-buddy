import { Search as SearchIcon } from "lucide-react";
import { useState } from "react";

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
  return (
    <div className="flex items-center gap-2">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSearch(draft);
          }
        }}
        placeholder="Buscar por título, artista, casa ou nº do lote… (Enter para pesquisar)"
        className="h-8 w-[220px] text-xs sm:w-64"
      />
      <Button size="sm" onClick={() => onSearch(draft)}>
        <SearchIcon className="mr-2 h-4 w-4" />
        Pesquisar
      </Button>
      {committed || draft ? (
        <Button
          variant="ghost"
          size="sm"
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
