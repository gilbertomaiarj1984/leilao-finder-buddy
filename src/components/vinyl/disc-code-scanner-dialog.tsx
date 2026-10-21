// Leitor de código do disco pela câmera do celular: código de barras (leitura ao vivo, no
// navegador) ou texto/número impresso (foto → IA transcreve). O código vira texto e é conferido
// no Discogs antes de ser usado.

import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, ScanText, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { lookupDiscCode, readDiscCodePhoto } from "@/lib/disc-code.functions";
import { parseDiscCode, type DiscCode, type DiscogsCodeInfo } from "@/lib/disc-code";

/** Lado maior da foto enviada à IA (basta para ler dígitos e não pesa no upload). */
const PHOTO_MAX_SIDE = 1280;
const SCAN_INTERVAL_MS = 250;

type Detector = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

/** BarcodeDetector nativo (Chrome/Android) ou ZXing (iOS/Safari/desktop), carregado sob demanda. */
async function createDetector(): Promise<Detector> {
  const Native = (
    window as unknown as {
      BarcodeDetector?: new (o: { formats: string[] }) => {
        detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
      };
    }
  ).BarcodeDetector;
  if (Native) {
    const detector = new Native({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"],
    });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatReader(hints);
  return async (video, canvas) => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      return null; // NotFoundException: ainda não achou código no quadro
    }
  };
}

export function DiscCodeScannerDialog({
  open,
  title = "Ler código do disco",
  confirmLabel = "Usar este código",
  skipLabel,
  askBeforeCamera = false,
  provider,
  onConfirm,
  onSkip,
  onClose,
}: {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  /** Quando presente, mostra o botão para seguir sem código (ex.: buscar só por nome). */
  skipLabel?: string;
  /** Não abre a câmera de cara: antes pergunta “abrir a câmera” ou seguir sem ela (buscar faixas). */
  askBeforeCamera?: boolean;
  provider?: "anthropic" | "gemini";
  onConfirm: (code: string, info: DiscogsCodeInfo | null) => void;
  onSkip?: () => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lookup = useServerFn(lookupDiscCode);
  const readPhoto = useServerFn(readDiscCodePhoto);

  const [cameraOn, setCameraOn] = useState(!askBeforeCamera);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState("");
  const [candidates, setCandidates] = useState<DiscCode[]>([]);
  const [picked, setPicked] = useState<{ code: string; info: DiscogsCodeInfo | null } | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Confere o código no Discogs e mostra o disco achado para o usuário confirmar.
  const pick = useCallback(
    async (raw: string) => {
      const code = parseDiscCode(raw);
      if (!code) {
        toast.error("Não consegui entender esse código.");
        return;
      }
      stopCamera();
      setChecking(true);
      try {
        const res = await lookup({ data: { code: code.value } });
        setPicked({ code: code.value, info: res.info });
      } catch {
        setPicked({ code: code.value, info: null });
      } finally {
        setChecking(false);
      }
    },
    [lookup, stopCamera],
  );

  // Câmera + leitura contínua do código de barras enquanto o diálogo está aberto e sem escolha.
  useEffect(() => {
    if (!open || picked || !cameraOn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setCameraError(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Este navegador não permite usar a câmera (precisa de HTTPS).");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const detect = await createDetector();
        const tick = async () => {
          if (cancelled) return;
          let found: string | null = null;
          if (video.readyState >= 2 && canvasRef.current) {
            found = await detect(video, canvasRef.current).catch(() => null);
          }
          if (found) {
            void pick(found);
            return;
          }
          timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
        };
        void tick();
      } catch (e) {
        if (!cancelled) {
          setCameraError(
            e instanceof Error && e.name === "NotAllowedError"
              ? "Permissão da câmera negada. Libere no navegador ou digite o código abaixo."
              : e instanceof Error
                ? e.message
                : "Não foi possível abrir a câmera.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stopCamera();
    };
  }, [open, picked, cameraOn, pick, stopCamera]);

  // Fecha limpando o estado (e soltando a câmera).
  function close() {
    stopCamera();
    setCameraOn(!askBeforeCamera);
    setPicked(null);
    setCandidates([]);
    setManual("");
    onClose();
  }

  // Foto do quadro atual → IA transcreve o código de barras/texto impresso.
  async function readText() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setReading(true);
    try {
      const res = await readPhoto({
        data: { image: canvas.toDataURL("image/jpeg", 0.85), provider },
      });
      setCandidates(res.codes);
      if (!res.codes.length) toast.error("Não consegui ler o código. Aproxime e tente de novo.");
      else if (res.codes.length === 1) await pick(res.codes[0]!.value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler a foto");
    } finally {
      setReading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {cameraOn
              ? "Aponte para o código de barras (leitura automática) ou use “Ler texto” para o número/código impresso no disco ou na capa."
              : "Com o código de barras ou o nº do disco a busca acerta o disco exato. A câmera só abre se você pedir."}
          </DialogDescription>
        </DialogHeader>

        {picked ? (
          <div className="space-y-3 text-sm">
            <p>
              Código: <span className="font-mono font-semibold">{picked.code}</span>
            </p>
            {picked.info ? (
              <div className="flex items-center gap-3 rounded-md border border-border p-2">
                {picked.info.cover ? (
                  <img
                    src={picked.info.cover}
                    alt=""
                    className="h-16 w-16 rounded bg-secondary object-contain"
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="truncate font-medium">{picked.info.album}</div>
                  <div className="truncate text-muted-foreground">
                    {picked.info.artist}
                    {picked.info.year ? ` · ${picked.info.year}` : ""}
                    {picked.info.tracks ? ` · ${picked.info.tracks} faixas` : ""}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                O Discogs não achou este código — você ainda pode salvá-lo no disco.
              </p>
            )}
          </div>
        ) : !cameraOn ? (
          <div className="space-y-3">
            <Button type="button" className="w-full" onClick={() => setCameraOn(true)}>
              <Camera className="mr-2 h-4 w-4" />
              Abrir a câmera
            </Button>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void pick(manual);
              }}
            >
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="ou digite o código de barras / nº do disco"
                inputMode="text"
              />
              <Button type="submit" variant="outline" disabled={!manual.trim() || checking}>
                OK
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-md bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-x-6 top-1/2 h-px bg-red-500/80" />
              {checking ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              ) : null}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            {cameraError ? <p className="text-xs text-destructive">{cameraError}</p> : null}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void readText()}
              disabled={reading || checking || !!cameraError}
            >
              {reading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ScanText className="mr-2 h-4 w-4" />
              )}
              {reading ? "Lendo…" : "Ler texto/número do código (foto)"}
            </Button>
            {candidates.length ? (
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <Button
                    key={c.value}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="font-mono"
                    onClick={() => void pick(c.value)}
                  >
                    {c.value}
                  </Button>
                ))}
              </div>
            ) : null}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void pick(manual);
              }}
            >
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="ou digite o código de barras / nº do disco"
                inputMode="text"
              />
              <Button type="submit" variant="outline" disabled={!manual.trim() || checking}>
                OK
              </Button>
            </form>
          </div>
        )}

        <DialogFooter>
          {picked ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPicked(null)}>
                <Camera className="mr-2 h-4 w-4" />
                Ler outro
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onConfirm(picked.code, picked.info);
                  close();
                }}
              >
                {confirmLabel}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              {skipLabel && onSkip ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onSkip();
                    close();
                  }}
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  {skipLabel}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
