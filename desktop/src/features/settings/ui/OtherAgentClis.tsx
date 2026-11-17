import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

/**
 * The other agent CLIs the Office can run (beyond the engines with accounts
 * above): installed or not, and how to install one. They sign in on their
 * own, the first time an agent starts on them.
 */
const CLIS: { name: string; cli: string; install?: string; docs: string }[] = [
  { name: "Grok · xAI", cli: "grok", docs: "https://docs.x.ai" },
  { name: "Qwen Code", cli: "qwen", install: "npm install -g @qwen-code/qwen-code", docs: "https://github.com/QwenLM/qwen-code" },
  { name: "Crush · Charm", cli: "crush", install: "npm install -g @charmland/crush", docs: "https://github.com/charmbracelet/crush" },
  { name: "Pi", cli: "pi", install: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent", docs: "https://pi.dev/docs/latest" },
  { name: "GitHub Copilot", cli: "copilot", install: "npm install -g @github/copilot", docs: "https://docs.github.com/copilot/concepts/agents/about-copilot-cli" },
  { name: "Cursor", cli: "cursor-agent", docs: "https://cursor.com/docs/cli/install" },
];

export function OtherAgentClis() {
  const installed = useQuery({
    queryKey: ["ai-accounts", "other-clis"],
    queryFn: () => invoke<boolean[]>("ai_accounts_cli_installed", { clis: CLIS.map((c) => c.cli) }),
    staleTime: 30_000,
  });
  return (
    <section className="grid gap-2" data-testid="other-agent-clis">
      <div>
        <h3 className="text-sm font-semibold">Other agent CLIs</h3>
        <p className="text-xs text-muted-foreground">
          The Office can run agents on these too. Each signs in on its own the first time an agent starts on it.
        </p>
      </div>
      <div className="divide-y divide-border/60 rounded-xl border border-border/60 bg-background/80">
        {CLIS.map((c, i) => {
          const ok = installed.data?.[i];
          return (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm" key={c.cli}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.name}</span>{" "}
                <code className="text-xs text-muted-foreground">{c.cli}</code>
              </span>
              {ok === undefined ? null : ok ? (
                <Badge variant="success">
                  <Check className="mr-1 h-3 w-3" />
                  Installed
                </Badge>
              ) : (
                <>
                  <Badge variant="outline">Not installed</Badge>
                  {c.install ? (
                    <Button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(c.install as string)
                          .then(() => toast.success("Install command copied. Run it in a terminal."))
                      }
                      size="sm"
                      title={c.install}
                      variant="outline"
                    >
                      <Copy />
                      Copy install command
                    </Button>
                  ) : null}
                </>
              )}
              <Button aria-label={`${c.name} docs`} onClick={() => void openUrl(c.docs)} size="icon" title="Docs" variant="ghost">
                <ExternalLink />
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
