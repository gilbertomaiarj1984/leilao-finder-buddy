/**
 * Extrai o objeto JSON da resposta de um modelo: do primeiro `{` ao último `}`, tolerante a cercas
 * de código (```json), texto antes/depois e raciocínio solto. `null` quando não há JSON válido.
 * Ponto único para todos os leitores de resposta de IA (avaliação, identificação, estado, Coleção,
 * De olho, fama das faixas).
 */
export function extractJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
