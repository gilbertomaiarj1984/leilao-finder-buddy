/**
 * Andamento da análise profunda dos vigiados ("Analisar vigiados"), num store simples de módulo
 * (sem React Query) para o rodapé mostrar o progresso em qualquer tela, mesmo depois de sair da
 * aba Vigiados, e guardar os erros até o usuário fechar. Só existe no navegador.
 */
import { useSyncExternalStore } from "react";

export type DeepErrorEntry = {
  /** Título do lote (ou "Chamada à IA" quando o erro não é de um lote). */
  title: string;
  house?: string;
  message: string;
};

type DeepProgressState = {
  status: "idle" | "running" | "done";
  /** Lotes já processados / total do dia. */
  done: number;
  total: number;
  evaluated: number;
  skipped: number;
  failed: number;
  errors: DeepErrorEntry[];
  /** Rótulo do dia analisado ("27/11"). */
  dayLabel: string;
};

const IDLE: DeepProgressState = {
  status: "idle",
  done: 0,
  total: 0,
  evaluated: 0,
  skipped: 0,
  failed: 0,
  errors: [],
  dayLabel: "",
};

let state: DeepProgressState = IDLE;
const listeners = new Set<() => void>();

function set(next: DeepProgressState) {
  state = next;
  for (const l of listeners) l();
}

export function startDeepProgress(total: number, dayLabel: string) {
  set({ ...IDLE, status: "running", total, dayLabel });
}

/** Soma o resultado de um bloco já processado. */
export function advanceDeepProgress(
  chunk: { size: number; evaluated: number; skipped: number; failed: number },
  errors: DeepErrorEntry[] = [],
) {
  set({
    ...state,
    done: Math.min(state.done + chunk.size, state.total),
    evaluated: state.evaluated + chunk.evaluated,
    skipped: state.skipped + chunk.skipped,
    failed: state.failed + chunk.failed,
    errors: [...state.errors, ...errors],
  });
}

export function finishDeepProgress(errors: DeepErrorEntry[] = []) {
  set({ ...state, status: "done", errors: [...state.errors, ...errors] });
}

export function clearDeepProgress() {
  set(IDLE);
}

export function getDeepProgress(): DeepProgressState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDeepProgress(): DeepProgressState {
  return useSyncExternalStore(subscribe, getDeepProgress, () => IDLE);
}
