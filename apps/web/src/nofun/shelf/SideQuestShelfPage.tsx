import type { EnvironmentId, SideQuestPin } from "@t3tools/contracts";
import { HTML_RENDER_MAX_HEIGHT } from "@t3tools/shared/htmlRender";
import { PinOffIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HtmlRenderFrame } from "../../components/chat/HtmlRenderFrame";
import { Button } from "../../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { ScrollArea } from "../../components/ui/scroll-area";
import { SidebarInset } from "../../components/ui/sidebar";
import { toastManager } from "../../components/ui/toast";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../../components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { isElectron } from "../../env";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { sideQuestShelfCommand } from "./shelfState";
import { EnvironmentPersonaAvatar, NOFUN_PERSONA, PersonaAvatar } from "../persona";

interface ShelfEntry {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly pin: SideQuestPin;
}

const formatTime = (iso: string) => new Date(iso).toLocaleString();

/**
 * The Side Quest shelf: every pinned page across connected environments.
 * Opening one shows the pinned snapshot in the same frame threads use, so it
 * renders even after its source thread is gone. It only loads when opened, so
 * agent updates never move it.
 */
export function SideQuestShelfPage() {
  const { environments } = useEnvironments();
  const run = useAtomCommand(sideQuestShelfCommand, { reportFailure: false });
  const connected = useMemo(
    () => environments.filter((environment) => environment.connection.phase === "connected"),
    [environments],
  );
  const [entries, setEntries] = useState<ReadonlyArray<ShelfEntry>>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Revision the viewer shows per pin; defaults to the current one.
  const [shownRevision, setShownRevision] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const results = await Promise.all(
      connected.map(async (environment) => {
        const result = await run({
          environmentId: environment.environmentId,
          input: { op: "list" },
        });
        return result._tag === "Success"
          ? result.value.pins.map((pin) => ({
              environmentId: environment.environmentId,
              environmentLabel: environment.label,
              pin,
            }))
          : [];
      }),
    );
    setEntries(results.flat().toSorted((a, b) => b.pin.createdAt.localeCompare(a.pin.createdAt)));
    setLoaded(true);
  }, [connected, run]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Loads the shelf when the page opens or environments change.
    void load();
  }, [load]);

  const keyOf = (entry: ShelfEntry) => `${entry.environmentId}:${entry.pin.id}`;
  const selected = entries.find((entry) => keyOf(entry) === selectedKey) ?? null;

  const unpin = async (entry: ShelfEntry) => {
    const result = await run({
      environmentId: entry.environmentId,
      input: { op: "unpin", pinId: entry.pin.id },
    });
    if (result._tag === "Success") {
      if (keyOf(entry) === selectedKey) setSelectedKey(null);
      await load();
    } else {
      toastManager.add({ type: "error", title: "Could not unpin" });
    }
  };

  const revision =
    selected === null
      ? null
      : (selected.pin.revisions.find(
          (candidate) =>
            candidate.revision === (shownRevision[keyOf(selected)] ?? selected.pin.currentRevision),
        ) ?? null);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          <WorkspaceBreadcrumb ariaLabel="Side Quest breadcrumb" className="min-w-0 py-2">
            <WorkspaceBreadcrumbItem current>
              <h1 className="flex items-center gap-2">
                <PersonaAvatar persona={NOFUN_PERSONA} className="size-4" />
                Side Quest
                <span className="font-mono text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {entries.length > 0 ? `${entries.length} pinned` : ""}
                </span>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <div className="flex min-h-0 flex-1">
          <ScrollArea className="min-h-0 w-72 shrink-0 border-e">
            <ul className="flex flex-col gap-1 p-2">
              {entries.map((entry) => (
                <li key={keyOf(entry)}>
                  <button
                    type="button"
                    aria-current={keyOf(entry) === selectedKey ? "true" : undefined}
                    onClick={() => setSelectedKey(keyOf(entry))}
                    className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:bg-accent"
                  >
                    <EnvironmentPersonaAvatar
                      environmentId={entry.environmentId}
                      className="size-7"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-semibold text-sm tracking-tight">
                        {entry.pin.title}
                      </span>
                      <span className="truncate text-muted-foreground text-xs">
                        {entry.environmentLabel} · {formatTime(entry.pin.createdAt)}
                        {entry.pin.sourceThreadId === null
                          ? ""
                          : ` · thread ${entry.pin.sourceThreadId.slice(0, 8)}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected !== null && revision !== null ? (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">
                    {selected.pin.title}
                  </span>
                  <Select
                    value={String(revision.revision)}
                    onValueChange={(value) =>
                      setShownRevision((current) => ({
                        ...current,
                        [keyOf(selected)]: Number(value),
                      }))
                    }
                  >
                    <SelectTrigger
                      aria-label="Revision history"
                      size="compact"
                      variant="ghost"
                      className="w-auto min-w-0"
                    >
                      <SelectValue>
                        {`Revision ${revision.revision}${revision.revision === selected.pin.currentRevision ? " (latest)" : ""}`}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {selected.pin.revisions
                        .toSorted((a, b) => b.revision - a.revision)
                        .map((item) => (
                          <SelectItem key={item.revision} value={String(item.revision)}>
                            {`Revision ${item.revision} - ${formatTime(item.createdAt)}`}
                          </SelectItem>
                        ))}
                    </SelectPopup>
                  </Select>
                  <Button size="xs" variant="outline" onClick={() => void unpin(selected)}>
                    <PinOffIcon />
                    Unpin
                  </Button>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-4">
                    <HtmlRenderFrame
                      // Each revision is its own page; never reuse a frozen frame.
                      key={revision.attachmentId}
                      environmentId={selected.environmentId}
                      htmlRender={{
                        attachmentId: revision.attachmentId,
                        title: selected.pin.title,
                        height: HTML_RENDER_MAX_HEIGHT,
                      }}
                    />
                  </div>
                </ScrollArea>
              </>
            ) : (
              <Empty>
                <EmptyHeader>
                  <PersonaAvatar
                    persona={NOFUN_PERSONA}
                    className="mx-auto mb-3 size-12 drop-shadow-md"
                  />
                  <EmptyTitle>
                    {loaded && entries.length === 0 ? "Nothing pinned" : "Side Quest"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {loaded && entries.length === 0
                      ? "Pin an HTML page from a thread and it shows up here, even after the thread is deleted."
                      : "Pick a pinned page to open it."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
