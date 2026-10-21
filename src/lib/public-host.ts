/** Evita SSRF para redes internas: exige host com ponto (FQDN) e não-privado. */
export function isPublicHost(host: string): boolean {
  if (!host || host === "localhost" || !host.includes(".")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}
