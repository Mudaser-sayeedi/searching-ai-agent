"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { SearchQuery } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

// Collapsible panel for managing the monitoring queries the agent runs.
export function QueriesPanel({
  queries,
  onChange,
}: {
  queries: SearchQuery[];
  onChange: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const enabledCount = queries.filter((q) => q.enabled).length;

  async function add() {
    const prompt = newPrompt.trim();
    if (!prompt) return;
    setBusy(true);
    await fetch("/api/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    setNewPrompt("");
    setBusy(false);
    await onChange();
  }

  async function toggle(q: SearchQuery) {
    await fetch("/api/queries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: q.id, enabled: !q.enabled }),
    });
    await onChange();
  }

  async function remove(id: string) {
    await fetch(`/api/queries?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await onChange();
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent/50"
      >
        <span>
          Monitoring queries{" "}
          <span className="font-normal text-muted-foreground">
            ({enabledCount} active / {queries.length})
          </span>
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t p-4">
              <ul className="flex flex-col gap-2">
                {queries.map((q) => (
                  <li key={q.id} className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={q.enabled}
                      onChange={() => toggle(q)}
                      className="mt-1 accent-primary"
                    />
                    <span
                      className={
                        q.enabled
                          ? "flex-1"
                          : "flex-1 text-muted-foreground line-through"
                      }
                    >
                      {q.prompt}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => remove(q.id)}
                      className="text-destructive hover:text-destructive"
                      aria-label="Remove query"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex gap-2">
                <Input
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                  placeholder="Add a query, e.g. 'Companies switching to Zoho Books'"
                />
                <Button
                  variant="secondary"
                  onClick={add}
                  disabled={busy || !newPrompt.trim()}
                >
                  <Plus /> Add
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
