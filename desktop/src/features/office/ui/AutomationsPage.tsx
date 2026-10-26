import * as React from "react";

import { sendToOffice } from "@/features/office/lib/officeLink";
import { startOffice } from "@/features/office/ui/OfficeHost";
import { PageHeader } from "@/shared/ui/PageHeader";

import { TriggersSection } from "./sections/TriggersSection";

/**
 * Automations: what starts work without anyone asking (schedules, webhooks,
 * the org's triggers) and what they've done. They were a tab of Michael's
 * panel on the Agents page ("Triggers"); they're the floor's, so they have a
 * page of their own.
 */
export function AutomationsPage() {
  // The automations live in the Office: it has to be running.
  React.useEffect(() => {
    startOffice();
    sendToOffice({ type: "state-request" });
  }, []);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-testid="automations-page"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6 sm:px-6">
        <PageHeader
          description="Schedules, webhooks and triggers that start work for the floor on their own."
          title="Automations"
        />
        <TriggersSection />
      </div>
    </div>
  );
}
