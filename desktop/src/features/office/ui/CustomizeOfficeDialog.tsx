import * as React from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

import { callOffice } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Switch } from "@/shared/ui/switch";

/** Opens Customize office from anywhere (a click on the CEO's desk). */
const OPEN_EVENT = "anything:customize-office";
export const openCustomizeOffice = () =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));

type Style = "auto" | "luxury" | "comfort" | "standard" | "lean";
type CafeSize = "small" | "normal" | "large";
type Amenity = "lounge" | "library" | "cafe" | "utility";
type Layout = {
  style: Style;
  cafe: CafeSize;
  fill: Record<Amenity, boolean>;
  cubicles: boolean;
};

const DEFAULT: Layout = {
  style: "auto",
  cafe: "normal",
  fill: { lounge: true, library: true, cafe: true, utility: true },
  cubicles: true,
};

const STYLES: { value: Style; label: string; hint: string }[] = [
  { value: "auto", label: "By team size", hint: "Plusher the smaller the team" },
  { value: "luxury", label: "Luxurious", hint: "Lounges and libraries" },
  { value: "comfort", label: "Comfortable", hint: "A lounge or two" },
  { value: "standard", label: "Standard", hint: "Some comfort, some storage" },
  { value: "lean", label: "Lean", hint: "Desks and the essentials" },
];
const CAFES: { value: CafeSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];
const AMENITIES: { value: Amenity; label: string }[] = [
  { value: "lounge", label: "Lounges" },
  { value: "library", label: "Libraries" },
  { value: "cafe", label: "Café tables" },
  { value: "utility", label: "Storage and printers" },
];

/** A row of choices, one picked. */
function Choices<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          className={cn(
            "rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
            o.value === value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:bg-accent",
          )}
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.hint}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Customize office: how the Office floor is laid out (style, café size, what
 * fills the spare space, cubicle panels). Opened by clicking the CEO's desk;
 * each change is saved at once and the floor rebuilds to it.
 */
export function CustomizeOfficeDialog() {
  const [open, setOpen] = React.useState(false);
  const [layout, setLayout] = React.useState<Layout>(DEFAULT);

  React.useEffect(() => {
    const show = () => {
      setOpen(true);
      callOffice<Partial<Layout>>("office.layout")
        .then((saved) =>
          setLayout({
            ...DEFAULT,
            ...saved,
            fill: { ...DEFAULT.fill, ...(saved?.fill ?? {}) },
          }),
        )
        .catch(() => setLayout(DEFAULT));
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  const save = (next: Layout) => {
    setLayout(next);
    callOffice("office.setLayout", { layout: next }).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : String(error)),
    );
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="max-w-md" data-testid="customize-office-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Customize office
          </DialogTitle>
          <DialogDescription>
            How the floor is laid out. Changes show on the floor straight away.
          </DialogDescription>
        </DialogHeader>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Style</h3>
          <Choices
            onChange={(style) => save({ ...layout, style })}
            options={STYLES}
            value={layout.style}
          />
          <p className="text-xs text-muted-foreground">
            {STYLES.find((s) => s.value === layout.style)?.hint}
          </p>
        </section>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Café</h3>
          <Choices
            onChange={(cafe) => save({ ...layout, cafe })}
            options={CAFES}
            value={layout.cafe}
          />
          <p className="text-xs text-muted-foreground">
            Seats for a fifth, a third or half of the team.
          </p>
        </section>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Spare space gets</h3>
          <div className="grid grid-cols-2 gap-2">
            {AMENITIES.map((a) => (
              <label className="flex items-center gap-2 text-sm" key={a.value}>
                <Checkbox
                  checked={layout.fill[a.value]}
                  data-testid={`customize-office-fill-${a.value}`}
                  onCheckedChange={(on) =>
                    save({
                      ...layout,
                      fill: { ...layout.fill, [a.value]: on === true },
                    })
                  }
                />
                {a.label}
              </label>
            ))}
          </div>
        </section>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="font-medium">Cubicle panels</span>
            <span className="block text-xs text-muted-foreground">
              A panel between neighbouring desks.
            </span>
          </span>
          <Switch
            checked={layout.cubicles}
            data-testid="customize-office-cubicles"
            onCheckedChange={(cubicles) => save({ ...layout, cubicles })}
          />
        </label>
      </DialogContent>
    </Dialog>
  );
}
