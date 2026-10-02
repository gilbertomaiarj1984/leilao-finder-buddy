import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

// Estado de UI que sobrevive a recarregar/fechar e reabrir o site: espelha o valor em
// `localStorage` (por navegador). SSR-safe: o 1º render usa sempre `initial` (igual ao HTML do
// servidor) e o valor salvo entra logo após a montagem; `hydrated` avisa quando isso aconteceu.

const PREFIX = "ui-state:";

interface Codec<T> {
  encode: (value: T) => unknown;
  decode: (raw: unknown) => T;
}

export const setCodec: Codec<Set<string>> = {
  encode: (v) => [...v],
  decode: (raw) => new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []),
};

export function usePersistedState<T>(
  key: string,
  initial: T,
  codec?: Codec<T>,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  const loaded = useRef(false);

  // Declarado ANTES do efeito de leitura: no 1º commit roda com `loaded=false` e não grava
  // o valor inicial por cima do salvo.
  useEffect(() => {
    if (!loaded.current) return;
    try {
      const enc = codec ? codec.encode(value) : value;
      window.localStorage.setItem(PREFIX + key, JSON.stringify(enc));
    } catch {
      // localStorage indisponível/cheio — best-effort.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        setValue(codec ? codec.decode(parsed) : (parsed as T));
      }
    } catch {
      // JSON corrompido ou storage indisponível — fica com o valor inicial.
    }
    loaded.current = true;
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, setValue, hydrated];
}

/** Dia local `YYYY-MM-DD` (para saber se a aba salva "day-N" ainda aponta para o mesmo dia). */
export function localDayKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Aba de dia (`day-N`, N = posição na barra, `todayIndex` = hoje) salva em `savedOn` → a mesma
 * aba hoje: se o dia virou, o índice anda para trás o mesmo tanto (continua no MESMO dia
 * enquanto ele estiver na barra). Abas não-dia (`watched`, `bids`) passam intactas.
 */
export function shiftSavedDayTab(
  tab: string,
  savedOn: string,
  today: string,
  barLength: number,
): string {
  const m = /^day-(\d+)$/.exec(tab);
  if (!m || savedOn === today) return tab;
  const diff = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${savedOn}T00:00:00Z`)) / 86_400_000,
  );
  const idx = Number(m[1]) - (Number.isFinite(diff) ? diff : 0);
  return `day-${Math.max(0, Math.min(barLength - 1, idx))}`;
}

/**
 * Salva a rolagem da janela por `key` e, quando `ready`, devolve o usuário ao ponto salvo —
 * esperando a página crescer (lista carregando) por até ~8s e desistindo se ele rolar antes.
 */
export function usePersistedScroll(key: string, ready: boolean): void {
  const restored = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const storeKey = `${PREFIX}scroll:${key}`;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let canSave = false;

    const stop = () => {
      cancelled = true;
      canSave = true;
    };
    const onUserScroll = () => {
      if (!canSave) stop();
    };
    const onScroll = () => {
      if (!canSave) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          window.localStorage.setItem(storeKey, String(Math.round(window.scrollY)));
        } catch {
          // best-effort
        }
      }, 150);
    };

    let target = 0;
    if (restored.current !== key) {
      restored.current = key;
      try {
        target = Number(window.localStorage.getItem(storeKey)) || 0;
      } catch {
        target = 0;
      }
    }

    if (target <= 0) {
      canSave = true;
    } else {
      const started = Date.now();
      const tryRestore = () => {
        if (cancelled) return;
        const reachable = document.documentElement.scrollHeight - window.innerHeight;
        if (reachable >= target || Date.now() - started > 8000) {
          window.scrollTo(0, target);
          canSave = true;
          return;
        }
        timer = setTimeout(tryRestore, 150);
      };
      tryRestore();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (saveTimer) clearTimeout(saveTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
    };
  }, [key, ready]);
}
