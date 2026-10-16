import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";

import { officeCth } from "@/features/office/lib/officeCth";
import { useOfficeAgents } from "@/features/office/lib/officeLink";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Markdown } from "@/shared/ui/markdown";

import {
  ErrorLine,
  Muted,
  Pre,
  SECTION_SELECT,
  SectionCard,
} from "./SectionBits";

/** Which agent's memory is open; the Graph section can jump here. */
let pendingMemoryAgent: string | null = null;
export function openMemoryFor(agentId: string): void {
  pendingMemoryAgent = agentId;
}

function SearchBox({
  placeholder,
  busy,
  onSearch,
  testId,
}: {
  placeholder: string;
  busy: boolean;
  onSearch: (query: string) => void;
  testId: string;
}) {
  const [query, setQuery] = React.useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (query.trim()) onSearch(query.trim());
      }}
    >
      <Input
        data-testid={testId}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        value={query}
      />
      <Button disabled={busy || !query.trim()} type="submit" variant="outline">
        {busy ? <Loader2 className="animate-spin" /> : <Search />}
        Search
      </Button>
    </form>
  );
}

/** Every agent's memory file, and search across the hive's notes. */
export function MemorySection() {
  const { agents, selectedId } = useOfficeAgents();
  const [who, setWho] = React.useState<string>(
    () => pendingMemoryAgent ?? selectedId ?? agents[0]?.id ?? "god",
  );
  React.useEffect(() => {
    pendingMemoryAgent = null;
  }, []);

  const memory = useQuery({
    queryKey: ["office", "memory", who],
    queryFn: () => officeCth<string>("hiveMemory", who),
    refetchInterval: 15_000,
  });
  const text = useMutation({
    mutationFn: (query: string) =>
      officeCth<{
        ok: boolean;
        results: { source: string; excerpt: string }[];
        error?: string;
      }>("textSearch", query),
  });
  const semantic = useMutation({
    mutationFn: (query: string) =>
      officeCth<{ ok: boolean; output: string; error?: string }>(
        "searchMemory",
        query,
      ),
  });

  return (
    <div className="grid gap-4" data-testid="section-memory">
      <SectionCard
        action={
          <select
            aria-label="Whose memory"
            className={SECTION_SELECT}
            onChange={(event) => setWho(event.target.value)}
            value={who}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        }
        description="What each agent keeps between sessions: decisions, preferences, lessons."
        title="Memory file"
      >
        {memory.data?.trim() ? (
          <div className="max-h-[28rem] overflow-y-auto rounded-xl bg-muted/30 px-4 py-3 text-sm">
            <Markdown className="leading-6" content={memory.data} />
          </div>
        ) : (
          <Muted>
            {memory.isLoading ? "Loading…" : "Nothing remembered yet."}
          </Muted>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          description="Exact words across the board, tasks and every memory file."
          title="Text search"
        >
          <SearchBox
            busy={text.isPending}
            onSearch={(query) => text.mutate(query)}
            placeholder="Find a word or phrase"
            testId="memory-text-search"
          />
          <ErrorLine error={text.error} />
          {text.data ? (
            text.data.ok && text.data.results.length > 0 ? (
              <ul className="grid gap-2">
                {text.data.results.slice(0, 10).map((result, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: search results without ids
                  <li className="grid gap-1" key={index}>
                    <span className="font-mono text-xs text-muted-foreground">
                      {result.source}
                    </span>
                    <Pre className="max-h-40">{result.excerpt}</Pre>
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>{text.data.error ?? "Nothing matched."}</Muted>
            )
          ) : null}
        </SectionCard>
        <SectionCard
          description="Meaning, not exact words, over the hive's long-term memory."
          title="Semantic search"
        >
          <SearchBox
            busy={semantic.isPending}
            onSearch={(query) => semantic.mutate(query)}
            placeholder="What did we decide about…"
            testId="memory-semantic-search"
          />
          <ErrorLine error={semantic.error} />
          {semantic.data ? (
            <Pre>
              {semantic.data.ok
                ? semantic.data.output || "Nothing matched."
                : `Search failed: ${semantic.data.error ?? "unknown error"}`}
            </Pre>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}
