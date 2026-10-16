import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { callOffice } from "@/features/office/lib/officeLink";

/** A worker's control state, as the Office reports it. */
export type AgentControl = {
  paused: boolean;
  halted: boolean;
  autoDeliveryPaused: boolean;
  pendingSteers: number;
};

const controlKey = (id: string) => ["office", "control", id] as const;
const FLOOR_DELIVERY_KEY = ["office", "floor-delivery"] as const;

export function useAgentControl(id: string, enabled: boolean) {
  return useQuery({
    queryKey: controlKey(id),
    queryFn: () => callOffice<AgentControl | null>("agent.control", { id }),
    enabled,
    refetchInterval: 5_000,
  });
}

/** The floor-wide auto-delivery switch (Michael's header). */
export function useFloorDelivery(enabled: boolean) {
  return useQuery({
    queryKey: FLOOR_DELIVERY_KEY,
    queryFn: () => callOffice<{ paused: boolean }>("floor.delivery"),
    enabled,
    refetchInterval: 15_000,
  });
}

/** The Office's agent controls; each refreshes what it changed. */
export function useOfficeAgentActions(id: string) {
  const client = useQueryClient();
  const setControl = (control: AgentControl | null) => {
    if (control) client.setQueryData(controlKey(id), control);
  };
  const call =
    <T>(op: string) =>
    (args: Record<string, unknown> = {}) =>
      callOffice<T>(op, { id, ...args });

  return {
    message: useMutation({ mutationFn: call<boolean>("agent.message") }),
    removeQueued: useMutation({
      mutationFn: (messageId: string) =>
        callOffice("agent.queue.remove", { id, messageId }),
    }),
    steer: useMutation({
      mutationFn: call<AgentControl | null>("agent.steer"),
      onSuccess: setControl,
    }),
    pause: useMutation({
      mutationFn: (on: boolean) =>
        callOffice<AgentControl | null>("agent.pause", { id, on }),
      onSuccess: setControl,
    }),
    halt: useMutation({
      mutationFn: call<AgentControl | null>("agent.halt"),
      onSuccess: setControl,
    }),
    hold: useMutation({
      mutationFn: (on: boolean) => callOffice("agent.hold", { id, on }),
    }),
    ide: useMutation({ mutationFn: call("agent.ide") }),
    edit: useMutation({ mutationFn: call("agent.edit") }),
    openTerminal: useMutation({ mutationFn: call("agent.openTerminal") }),
    archive: useMutation({ mutationFn: call("agent.archive") }),
    floorDelivery: useMutation({
      mutationFn: (paused: boolean) =>
        callOffice<{ paused: boolean }>("floor.delivery.set", { paused }),
      onSuccess: (value) => client.setQueryData(FLOOR_DELIVERY_KEY, value),
    }),
  };
}
