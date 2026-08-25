import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PRICE_OPTIONS } from "./grouping";

export function ArtistFilter({
  artists,
  value,
  onChange,
  disabled = false,
}: {
  artists: { artist: string; count: number }[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open && !disabled} onOpenChange={(next) => !disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between sm:w-72"
        >
          <span className="truncate">{value || `Todos os artistas (${artists.length})`}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,90vw)] p-0">
        <Command>
          <CommandInput placeholder="Buscar artista..." />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum artista encontrado.</CommandEmpty>
            <CommandItem
              value="__todos"
              onSelect={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <Check className={value ? "mr-2 h-4 w-4 opacity-0" : "mr-2 h-4 w-4"} />
              Todos os artistas
            </CommandItem>
            {artists.map((item) => (
              <CommandItem
                key={item.artist}
                value={item.artist}
                onSelect={() => {
                  onChange(item.artist === value ? "" : item.artist);
                  setOpen(false);
                }}
              >
                <Check
                  className={value === item.artist ? "mr-2 h-4 w-4" : "mr-2 h-4 w-4 opacity-0"}
                />
                <span className="truncate">{item.artist}</span>
                <span className="ml-auto text-xs text-muted-foreground">{item.count}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function PriceFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Select
      value={value || "__all"}
      onValueChange={(next) => onChange(next === "__all" ? "" : next)}
    >
      <SelectTrigger className="w-full sm:w-44">
        <SelectValue placeholder="Todos os valores" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">Todos os valores</SelectItem>
        {PRICE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
