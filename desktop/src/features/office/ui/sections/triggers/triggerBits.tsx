import * as React from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { SECTION_SELECT } from "../SectionBits";

export type TrustMode = "strict" | "allow-all" | "communication-only";

/** The Office's trust modes for inbound triggers. */
export const TRUST_MODES: { value: TrustMode; label: string; blurb: string }[] =
  [
    {
      value: "strict",
      label: "Strict",
      blurb: "Ask me before anything reaches the hive.",
    },
    {
      value: "allow-all",
      label: "Allow all",
      blurb: "Messages, directives and communication all flow.",
    },
    {
      value: "communication-only",
      label: "Communication only",
      blurb: "Chatter flows; directives need my approval.",
    },
  ];

export function TrustSelect({
  value,
  onChange,
}: {
  value: TrustMode;
  onChange: (mode: TrustMode) => void;
}) {
  const mode = TRUST_MODES.find((m) => m.value === value);
  return (
    <div className="grid gap-1">
      <select
        aria-label="Trust"
        className={SECTION_SELECT}
        onChange={(event) => onChange(event.target.value as TrustMode)}
        value={value}
      >
        {TRUST_MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {mode ? (
        <p className="text-xs text-muted-foreground">{mode.blurb}</p>
      ) : null}
    </div>
  );
}

export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Couldn't copy to the clipboard.");
  }
}

/** A secret shown masked, with reveal and (optionally) copy. */
export function SecretInput({
  value,
  onChange,
  onBlur,
  placeholder,
  copyLabel,
  readOnly,
}: {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  copyLabel?: string;
  readOnly?: boolean;
}) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <div className="flex gap-2">
      <Input
        autoComplete="off"
        className="font-mono text-xs"
        onBlur={onBlur}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        type={revealed ? "text" : "password"}
        value={value}
      />
      <Button
        aria-label={revealed ? "Hide" : "Show"}
        onClick={() => setRevealed((r) => !r)}
        size="icon"
        type="button"
        variant="outline"
      >
        {revealed ? <EyeOff /> : <Eye />}
      </Button>
      {copyLabel ? (
        <Button
          aria-label={`Copy ${copyLabel}`}
          disabled={!value}
          onClick={() => void copyText(value, copyLabel)}
          size="icon"
          type="button"
          variant="outline"
        >
          <Copy />
        </Button>
      ) : null}
    </div>
  );
}
