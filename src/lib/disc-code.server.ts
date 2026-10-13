// Leitura do código do disco por FOTO (OCR via IA de visão): o usuário aponta a câmera para o
// código de barras ou para o texto/número impresso; a IA transcreve e `extractDiscCodes` isola
// os candidatos. A leitura ao vivo do código de barras roda no navegador (sem custo de IA).
import { aiConfigured, resolveGeminiModel } from "./ai-eval.server";
import type { AiProvider } from "./ai-provider";
import { runText } from "./ai-provider.server";
import { extractDiscCodes, type DiscCode } from "./disc-code";

const SYSTEM =
  "Você lê códigos impressos em discos de vinil, capas e contracapas. Responda SOMENTE com o " +
  "texto transcrito, uma linha por código, sem explicações.";

const PROMPT =
  "Na foto há um código de barras, ou o número impresso sob ele, ou o número de catálogo/matriz " +
  "de um disco. Transcreva exatamente os DÍGITOS do código de barras (EAN/UPC, 8 a 14 dígitos, " +
  "sem espaços) e/ou o número de catálogo (ex.: 'SHVL 804', 'EMI 064-79154'). Se houver vários, " +
  "liste um por linha, o código de barras primeiro. Se não conseguir ler nada, responda apenas: NADA.";

/** Teto do data URL recebido (a foto é reduzida no cliente; isto só barra abuso). */
const MAX_PHOTO_CHARS = 6_000_000;

export async function readDiscCodeFromPhoto(
  image: string,
  provider: AiProvider,
): Promise<{ codes: DiscCode[]; raw: string }> {
  if (!aiConfigured()) {
    throw new Error("A IA não está configurada (nenhuma chave de provedor no servidor).");
  }
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_PHOTO_CHARS) {
    throw new Error("Foto inválida ou grande demais.");
  }
  const r = await runText(
    { system: SYSTEM, maxTokens: 120, text: PROMPT, image },
    provider,
    await resolveGeminiModel(),
  );
  const raw = r.text.trim();
  return { codes: /^nada\b/i.test(raw) ? [] : extractDiscCodes(raw), raw };
}
