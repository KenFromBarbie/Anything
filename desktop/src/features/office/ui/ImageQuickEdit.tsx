import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  Crop,
  Loader2,
  Pencil,
  RotateCw,
  Save,
  Type,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

import { ARTIFACTS_KEY, type Artifact } from "./ArtifactsPage";

type Tool = "draw" | "text" | "crop";
const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#ffffff",
  "#000000",
];
const HISTORY_KEPT = 20;

/**
 * Quick edits on an image artifact, in the Studio: crop, rotate, draw and
 * add text, saved as a new artifact ("(edited)") beside the original.
 */
export function ImageQuickEdit({
  item,
  open,
  onOpenChange,
}: {
  item: Artifact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const history = React.useRef<ImageData[]>([]);
  const [tool, setTool] = React.useState<Tool>("draw");
  const [color, setColor] = React.useState(COLORS[0]);
  const [text, setText] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [canUndo, setCanUndo] = React.useState(false);
  const drag = React.useRef<{ x: number; y: number } | null>(null);
  const [cropBox, setCropBox] = React.useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // Load the picture (fetched, so the canvas can be saved again).
  React.useEffect(() => {
    if (!open || !item.path) return;
    setReady(false);
    history.current = [];
    setCanUndo(false);
    let cancelled = false;
    void (async () => {
      try {
        const blob = await (
          await fetch(convertFileSrc(item.path as string))
        ).blob();
        const bitmap = await createImageBitmap(blob);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
        setReady(true);
      } catch (error) {
        toast.error(`Couldn't open the image: ${String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item.path]);

  const ctx = () => canvasRef.current?.getContext("2d") ?? null;
  const remember = () => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    history.current = [
      ...history.current.slice(-(HISTORY_KEPT - 1)),
      c.getImageData(0, 0, canvas.width, canvas.height),
    ];
    setCanUndo(true);
  };
  const undo = () => {
    const canvas = canvasRef.current;
    const last = history.current.pop();
    if (!canvas || !last) return;
    canvas.width = last.width;
    canvas.height = last.height;
    ctx()?.putImageData(last, 0, 0);
    setCanUndo(history.current.length > 0);
  };
  /** Pointer position in the picture's own pixels. */
  const at = (event: React.PointerEvent) => {
    const canvas = canvasRef.current as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const brush = () => Math.max(3, (canvasRef.current?.width ?? 1000) / 250);

  const onDown = (event: React.PointerEvent) => {
    if (!ready) return;
    const p = at(event);
    if (tool === "text") {
      if (!text.trim()) {
        toast("Type the text first, then click where it goes.");
        return;
      }
      remember();
      const c = ctx();
      if (!c) return;
      const size = Math.max(18, (canvasRef.current?.width ?? 1000) / 28);
      c.font = `600 ${size}px system-ui, sans-serif`;
      c.fillStyle = color;
      c.textBaseline = "top";
      c.fillText(text, p.x, p.y);
      return;
    }
    (event.target as Element).setPointerCapture(event.pointerId);
    drag.current = p;
    if (tool === "draw") {
      remember();
      const c = ctx();
      if (!c) return;
      c.strokeStyle = color;
      c.lineWidth = brush();
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(p.x, p.y);
    } else {
      setCropBox({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };
  const onMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const p = at(event);
    if (tool === "draw") {
      const c = ctx();
      c?.lineTo(p.x, p.y);
      c?.stroke();
    } else if (tool === "crop") {
      const start = drag.current;
      setCropBox({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      });
    }
  };
  const onUp = () => {
    drag.current = null;
  };

  const applyCrop = () => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c || !cropBox || cropBox.w < 4 || cropBox.h < 4) return;
    remember();
    const piece = c.getImageData(
      Math.round(cropBox.x),
      Math.round(cropBox.y),
      Math.round(cropBox.w),
      Math.round(cropBox.h),
    );
    canvas.width = piece.width;
    canvas.height = piece.height;
    c.putImageData(piece, 0, 0);
    setCropBox(null);
  };
  const rotate = () => {
    const canvas = canvasRef.current;
    const c = ctx();
    if (!canvas || !c) return;
    remember();
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d")?.drawImage(canvas, 0, 0);
    canvas.width = copy.height;
    canvas.height = copy.width;
    c.translate(canvas.width, 0);
    c.rotate(Math.PI / 2);
    c.drawImage(copy, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    setCropBox(null);
  };
  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      await invoke("office_artifact_save_edit", {
        fromId: item.id,
        pngBase64: canvas.toDataURL("image/png"),
      });
      void client.invalidateQueries({ queryKey: ARTIFACTS_KEY });
      toast.success("Saved as a new artifact.");
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  const canvas = canvasRef.current;
  const box =
    cropBox && canvas
      ? {
          left: `${(cropBox.x / canvas.width) * 100}%`,
          top: `${(cropBox.y / canvas.height) * 100}%`,
          width: `${(cropBox.w / canvas.width) * 100}%`,
          height: `${(cropBox.h / canvas.height) * 100}%`,
        }
      : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-5xl" data-testid="image-quick-edit">
        <DialogHeader>
          <DialogTitle>Edit {item.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["draw", Pencil, "Draw"],
              ["text", Type, "Text"],
              ["crop", Crop, "Crop"],
            ] as const
          ).map(([key, Icon, label]) => (
            <Button
              aria-pressed={tool === key}
              key={key}
              onClick={() => {
                setTool(key);
                setCropBox(null);
              }}
              size="sm"
              variant={tool === key ? "secondary" : "ghost"}
            >
              <Icon />
              {label}
            </Button>
          ))}
          <Button onClick={rotate} size="sm" variant="ghost">
            <RotateCw />
            Rotate
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          {COLORS.map((c) => (
            <button
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              className={cn(
                "h-5 w-5 rounded-full border border-border",
                color === c &&
                  "ring-2 ring-primary ring-offset-1 ring-offset-background",
              )}
              key={c}
              onClick={() => setColor(c)}
              style={{ background: c }}
              type="button"
            />
          ))}
          {tool === "text" ? (
            <Input
              className="ml-1 h-8 w-56"
              onChange={(event) => setText(event.target.value)}
              placeholder="Text, then click the picture"
              value={text}
            />
          ) : null}
          {tool === "crop" && cropBox && cropBox.w > 4 ? (
            <Button onClick={applyCrop} size="sm">
              Crop to selection
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button disabled={!canUndo} onClick={undo} size="sm" variant="ghost">
            <Undo2 />
            Undo
          </Button>
          <Button
            disabled={!ready || saving}
            onClick={() => void save()}
            size="sm"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save as new
          </Button>
        </div>
        <div className="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-xl bg-muted/30 p-2">
          <div className="relative inline-block max-h-[68vh]">
            <canvas
              className={cn(
                "block max-h-[68vh] max-w-full touch-none",
                tool === "draw" ? "cursor-crosshair" : "cursor-cell",
              )}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              ref={canvasRef}
            />
            {box ? (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
                style={box}
              />
            ) : null}
            {!ready ? (
              <Loader2 className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
