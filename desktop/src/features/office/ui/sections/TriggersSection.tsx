import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

import { SectionCard } from "./SectionBits";
import { ContextPanel } from "./triggers/ContextPanel";
import { HistoryPanel } from "./triggers/HistoryPanel";
import { OrgPanel } from "./triggers/OrgPanel";
import { SchedulesPanel } from "./triggers/SchedulesPanel";
import { WebhooksPanel } from "./triggers/WebhooksPanel";

/** Everything that can start work without you typing. */
export function TriggersSection() {
  return (
    <SectionCard
      description="Everything that can start work without you typing."
      testId="section-triggers"
      title="Triggers"
    >
      <Tabs defaultValue="schedules">
        <TabsList className="flex-wrap justify-start">
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="org">Organisation</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-4" value="schedules">
          <SchedulesPanel />
        </TabsContent>
        <TabsContent className="mt-4" value="context">
          <ContextPanel />
        </TabsContent>
        <TabsContent className="mt-4" value="webhooks">
          <WebhooksPanel />
        </TabsContent>
        <TabsContent className="mt-4" value="org">
          <OrgPanel />
        </TabsContent>
        <TabsContent className="mt-4" value="history">
          <HistoryPanel />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
