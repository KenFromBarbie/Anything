import assert from "node:assert/strict";
import test from "node:test";

import {
  startManagedAgentWithRules,
  respawnManagedAgentWithRules,
} from "./managedAgentControlActions.ts";

function agent(overrides = {}) {
  return {
    pubkey: "deadbeef".repeat(8),
    name: "Mesh Agent",
    personaId: null,
    relayUrl: "ws://localhost:3000",
    acpCommand: "buzz-acp",
    agentCommand: "goose",
    agentArgs: [],
    mcpCommand: "",
    turnTimeoutSeconds: 320,
    idleTimeoutSeconds: null,
    maxTurnDurationSeconds: null,
    parallelism: 1,
    systemPrompt: null,
    model: "hf://demo/model.gguf",
    envVars: {},
    status: "stopped",
    pid: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastStartedAt: null,
    lastStoppedAt: null,
    lastExitCode: null,
    lastError: null,
    logPath: null,
    startOnAppLaunch: false,
    backend: { type: "local" },
    backendAgentId: null,
    respondTo: "owner-only",
    respondToAllowlist: [],
    ...overrides,
  };
}

test("relay-mesh agents delegate start to the backend preflight", async () => {
  const meshAgent = agent({
    envVars: {
      BUZZ_AGENT_PROVIDER: "openai",
      OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:9337/v1/",
    },
  });

  let calledWith = null;
  await startManagedAgentWithRules({
    agent: meshAgent,
    startManagedAgent: async (pubkey) => {
      calledWith = pubkey;
    },
  });
  assert.equal(calledWith, meshAgent.pubkey);

  // Backend preflight failures (e.g. no live serve target) propagate as-is.
  await assert.rejects(
    startManagedAgentWithRules({
      agent: meshAgent,
      startManagedAgent: async () => {
        throw new Error("no live serve target is available for this model");
      },
    }),
    /no live serve target/,
  );
});

test("ordinary local agents still start normally", async () => {
  let calledWith = null;
  await startManagedAgentWithRules({
    agent: agent(),
    startManagedAgent: async (pubkey) => {
      calledWith = pubkey;
    },
  });
  assert.equal(calledWith, "deadbeef".repeat(8));
});

// --- respawnManagedAgentWithRules: stop→clear→start boundary tests -----------

test("test_respawn_stop_success_start_failure_onStopped_still_fires", async () => {
  // Prove: onStopped fires at the stop-success boundary even when start later
  // throws.  This is the key discriminator: on round-1 code the clear only
  // ran after the full respawn, so a failed start left the badge intact.
  const runningAgent = agent({ status: "running" });
  let onStoppedFired = false;

  await assert.rejects(
    respawnManagedAgentWithRules({
      agent: runningAgent,
      stopManagedAgent: async () => {
        /* stop succeeds */
      },
      startManagedAgent: async () => {
        throw new Error("start failed");
      },
      onStopped: () => {
        onStoppedFired = true;
      },
    }),
    /start failed/,
  );

  assert.ok(
    onStoppedFired,
    "onStopped must fire at stop-success boundary even when start subsequently fails",
  );
});

test("test_respawn_stop_failure_onStopped_not_called", async () => {
  // Prove: onStopped does NOT fire when stop itself throws.  Clearing on a
  // failed stop would remove a badge that is still legitimately active.
  const runningAgent = agent({ status: "running" });
  let onStoppedFired = false;

  await assert.rejects(
    respawnManagedAgentWithRules({
      agent: runningAgent,
      stopManagedAgent: async () => {
        throw new Error("stop failed");
      },
      startManagedAgent: async () => {
        /* should not be reached */
      },
      onStopped: () => {
        onStoppedFired = true;
      },
    }),
    /stop failed/,
  );

  assert.ok(
    !onStoppedFired,
    "onStopped must NOT fire when stop itself fails — badge is still active",
  );
});

test("test_respawn_onStopped_fires_before_start_resolves", async () => {
  // Prove: onStopped fires strictly between stop resolution and start
  // invocation.  A clear that fires after start begins can tombstone genuine
  // new turns from the freshly spawned process.
  const runningAgent = agent({ status: "running" });
  const events = [];

  await respawnManagedAgentWithRules({
    agent: runningAgent,
    stopManagedAgent: async () => {
      events.push("stop");
    },
    startManagedAgent: async () => {
      events.push("start");
    },
    onStopped: () => {
      events.push("onStopped");
    },
  });

  assert.deepEqual(
    events,
    ["stop", "onStopped", "start"],
    "onStopped must fire after stop resolves and before start is called",
  );
});

// ─── Office agent (Michael) ──────────────────────────────────────────────────
// He runs in the Office, so his card must never deploy to a provider or send
// `!shutdown` (which would reach him as a chat request from the owner).

function officeAgent(overrides = {}) {
  return agent({
    name: "Michael",
    agentCommand: "office",
    backend: { type: "provider", id: "office", config: {} },
    ...overrides,
  });
}

test("office agent card offers Open/Stop Office, not Deploy/Shutdown", async () => {
  const { getManagedAgentPrimaryActionLabel, isOfficeAgent } = await import(
    "./managedAgentControlActions.ts"
  );
  assert.equal(isOfficeAgent(officeAgent()), true);
  assert.equal(
    isOfficeAgent(
      agent({ backend: { type: "provider", id: "k8s", config: {} } }),
    ),
    false,
  );
  assert.equal(getManagedAgentPrimaryActionLabel(officeAgent()), "Open Office");
  assert.equal(
    getManagedAgentPrimaryActionLabel(
      officeAgent({ status: "deployed", backendAgentId: "office" }),
    ),
    "Stop Office",
  );
});

test("stopping the office agent stops the Office instead of sending !shutdown", async () => {
  const { stopManagedAgentWithRules } = await import(
    "./managedAgentControlActions.ts"
  );
  const michael = officeAgent({ status: "deployed", backendAgentId: "office" });
  let stopped = null;
  const result = await stopManagedAgentWithRules({
    agent: michael,
    channels: [],
    preferredChannelId: "would-receive-a-shutdown-message",
    relayAgents: [],
    stopManagedAgent: async (pubkey) => {
      stopped = pubkey;
    },
  });
  assert.equal(stopped, michael.pubkey);
  assert.match(result.noticeMessage ?? "", /Office stopped/);
});

test("deleting the office agent sends no !shutdown and asks no confirm", async () => {
  const { deleteManagedAgentWithRules } = await import(
    "./managedAgentControlActions.ts"
  );
  const michael = officeAgent({ status: "deployed", backendAgentId: "office" });
  let deleted = null;
  const result = await deleteManagedAgentWithRules({
    agent: michael,
    channels: [],
    preferredChannelId: "would-receive-a-shutdown-message",
    relayAgents: [],
    getAvailability: () => "online",
    deleteManagedAgent: async (input) => {
      deleted = input;
    },
  });
  assert.deepEqual(deleted, { pubkey: michael.pubkey });
  assert.deepEqual(result, {});
});

// ─── Office workers (agents hired on the floor) ──────────────────────────────
// Buzz holds their identities, but the Office runs them: their controls must
// never stop the whole Office.

function officeWorker(overrides = {}) {
  return officeAgent({
    name: "Jim",
    backend: {
      type: "provider",
      id: "office",
      config: { officeAgentId: "jim-1" },
    },
    ...overrides,
  });
}

test("an office worker is told apart from Michael and only opens the Office", async () => {
  const { getManagedAgentPrimaryActionLabel, isOfficeAgent, isOfficeWorker } =
    await import("./managedAgentControlActions.ts");
  assert.equal(isOfficeAgent(officeWorker()), true);
  assert.equal(isOfficeWorker(officeWorker()), true);
  assert.equal(isOfficeWorker(officeAgent()), false);
  assert.equal(
    getManagedAgentPrimaryActionLabel(
      officeWorker({ status: "deployed", backendAgentId: "office" }),
    ),
    "Open Office",
  );
});

test("deleting an office worker removes only its record and says how to retire it", async () => {
  const { deleteManagedAgentWithRules } = await import(
    "./managedAgentControlActions.ts"
  );
  const jim = officeWorker({ status: "deployed", backendAgentId: "office" });
  let deleted = null;
  const result = await deleteManagedAgentWithRules({
    agent: jim,
    channels: [],
    preferredChannelId: "would-receive-a-shutdown-message",
    relayAgents: [],
    getAvailability: () => "online",
    deleteManagedAgent: async (input) => {
      deleted = input;
    },
  });
  assert.deepEqual(deleted, { pubkey: jim.pubkey });
  assert.match(result.noticeMessage ?? "", /remove it in the Office/);
});
