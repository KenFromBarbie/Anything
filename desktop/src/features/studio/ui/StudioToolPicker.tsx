import { STUDIO_TOOLS } from "@/features/studio/lib/studioInstall";
import { cn } from "@/shared/lib/cn";
import { Checkbox } from "@/shared/ui/checkbox";

/** Checkboxes for the Studio's tools. */
export function StudioToolPicker({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (tools: string[]) => void;
  value: string[];
}) {
  const toggle = (id: string, on: boolean) =>
    onChange(
      STUDIO_TOOLS.map((t) => t.id).filter((t) =>
        t === id ? on : value.includes(t),
      ),
    );
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="studio-tool-picker">
      {STUDIO_TOOLS.map((tool) => {
        const checked = value.includes(tool.id);
        const inputId = `studio-tool-${tool.id}`;
        return (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
              checked
                ? "border-primary/40 bg-primary/5"
                : "border-border/70 hover:bg-muted/40",
              disabled && "cursor-not-allowed opacity-60",
            )}
            htmlFor={inputId}
            key={tool.id}
          >
            <Checkbox
              checked={checked}
              className="mt-0.5"
              disabled={disabled}
              id={inputId}
              onCheckedChange={(next) => toggle(tool.id, next === true)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{tool.label}</span>
              <span className="block text-xs text-muted-foreground">
                {tool.detail}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
