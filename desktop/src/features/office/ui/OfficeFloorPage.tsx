import { setOfficeAnchor } from "@/features/office/lib/officeAnchor";
import { useShowOfficePart } from "@/features/office/lib/officeView";
import { PageHeader } from "@/shared/ui/PageHeader";

/**
 * The Office page: the floor where Michael and the agents work. The same live
 * Office frame as the Agents page (see OfficeAgentsPage), showing its floor.
 */
export function OfficeFloorPage() {
  useShowOfficePart("office");
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-6 sm:px-6"
      data-testid="office-page-content"
    >
      <PageHeader
        description="The floor: watch Michael and the agents at work."
        title="Office"
      />
      <div
        className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-background"
        data-testid="office-embed"
        ref={setOfficeAnchor}
      />
    </div>
  );
}
