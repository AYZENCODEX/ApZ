import { useState, useRef } from "react";
import type { KeyboardEvent } from "react";
import { Link } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Search, Plus, ExternalLink, Activity, X, XCircle, Zap, Tag, DollarSign, Info, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PROJECT_CATEGORIES } from "@/config/projects";
import { PROJECT_CREATE_FIELDS, PROJECT_CREATE_GROUPS } from "@/config/fields/project-create";
import { SchemaForm } from "@/components/schema/SchemaForm";

interface CreateForm {
  name: string;
  description: string;
  twitterHandle: string;
  discordUrl: string;
  websiteUrl: string;
  xpName: string;
  xpPrice: string;
  rewardEstimate: string;
  fundingAmount: string;
  deadline: string;
  category: string;
  subcategory: string;
  tier: string;
  durationType: string;
  difficulty: string;
  costType: string;
  experienceLevel: string;
  tutorialLink: string;
  tutorialSteps: string;
  badges: string[];
  thumbnailUrl: string;
  bannerUrl: string;
  projectType: string;
  exchangeSubType: string;
  accountCategory: string;
}

const EMPTY_FORM: CreateForm = {
  name: "", description: "",
  twitterHandle: "", discordUrl: "", websiteUrl: "",
  xpName: "", xpPrice: "0.01", rewardEstimate: "", fundingAmount: "", deadline: "",
  category: "", subcategory: "", tier: "1", durationType: "long", difficulty: "average", costType: "free", experienceLevel: "Beginner",
  tutorialLink: "", tutorialSteps: "", badges: [],
  thumbnailUrl: "", bannerUrl: "",
  projectType: "", exchangeSubType: "candydrop", accountCategory: "both",
};

type CreateTab = "basic" | "economics" | "meta" | "tutorial";

const CREATE_TABS: { id: CreateTab; label: string; icon: React.ElementType }[] = [
  { id: "basic",     label: "Basic",     icon: Info },
  { id: "economics", label: "Economics", icon: DollarSign },
  { id: "meta",      label: "Meta",      icon: Tag },
  { id: "tutorial",  label: "Tutorial",  icon: BookOpen },
];

// ─── Badge/tag input — Phase 7A. Type freely, press Space/Enter/, to commit
// a tag. Rendered manually outside SchemaForm since FieldDef has no generic
// "tags" type yet (same workaround components/game-entries.tsx and
// admin/project-detail.tsx's BadgeTagInput use). ────────────────────────────
function BadgeTagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === " " || e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const removeTag = (tag: string) => onChange(value.filter(t => t !== tag));

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 min-h-[2.25rem] bg-input border border-border rounded-lg px-2.5 py-1.5 focus-within:border-primary/60 transition-colors"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25"
        >
          {tag}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); removeTag(tag); }}
            className="hover:text-red-400 transition-colors"
          >
            <XCircle className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? "e.g. hot, low-cost, testnet..." : ""}
        className="flex-1 min-w-[8ch] bg-transparent outline-none font-mono text-xs placeholder:text-muted-foreground"
      />
    </div>
  );
}

export default function AdminProjects() {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  const [createTab, setCreateTab] = useState<CreateTab>("basic");
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const { data, isLoading, refetch } = useListProjects({ search, page: 1, limit: 50 });
  const { toast } = useToast();

  const handleCreate = () => {
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Name required" }); return; }
    const token = localStorage.getItem("ayzen_token") ?? "";
    const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        twitterHandle: form.twitterHandle || undefined,
        discordUrl: form.discordUrl || undefined,
        websiteUrl: form.websiteUrl || undefined,
        xpName: form.xpName.trim() || undefined,
        xpPrice: form.xpPrice ? Number(form.xpPrice) : 0.01,
        rewardEstimate: form.rewardEstimate ? Number(form.rewardEstimate) : 0,
        fundingAmount: form.fundingAmount ? Number(form.fundingAmount) : 0,
        deadline: form.deadline || undefined,
        category: form.category,
        tier: form.tier,
        durationType: form.durationType,
        difficulty: form.difficulty,
        costType: form.costType,
        experienceLevel: form.experienceLevel,
        tutorialLink: form.tutorialLink || undefined,
        tutorialSteps: form.tutorialSteps || undefined,
        badges: form.badges.length > 0 ? form.badges : undefined,
        thumbnailUrl: form.thumbnailUrl || undefined,
        bannerUrl: form.bannerUrl || undefined,
        projectType: form.projectType,
        exchangeSubType: form.exchangeSubType,
        accountCategory: form.accountCategory,
      }),
    }).then(async r => {
      if (r.ok) {
        toast({ title: "Project created", description: `${form.name} initialized.` });
        setForm(EMPTY_FORM); setShowCreate(false); setCreateTab("basic"); refetch();
      } else {
        const d = await r.json();
        toast({ variant: "destructive", title: "Failed", description: d.error });
      }
    }).catch(() => toast({ variant: "destructive", title: "Connection error" }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tighter uppercase">Project Database</h1>
          <p className="text-muted-foreground font-mono text-sm">Manage airdrop campaigns and protocols</p>
        </div>
        <Button className="font-mono uppercase text-xs tracking-wider gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Initialize Project
        </Button>
      </div>

      {/* ── Create dialog (4-tab overlay) ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card border border-card-border rounded-xl w-full max-w-xl shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent" />

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-card-border shrink-0">
              <h2 className="font-mono font-bold uppercase tracking-wider text-primary text-sm">Initialize New Protocol</h2>
              <button onClick={() => { setShowCreate(false); setForm(EMPTY_FORM); setCreateTab("basic"); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab navigation */}
            <div className="flex border-b border-border shrink-0 px-2 overflow-x-auto">
              {CREATE_TABS.map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setCreateTab(t.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-3 font-mono text-[10px] uppercase tracking-wider border-b-2 transition-all -mb-px whitespace-nowrap",
                      createTab === t.id
                        ? "border-primary text-primary font-bold"
                        : "border-transparent text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                  >
                    <Icon className="w-3 h-3" /> {t.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content — one generic SchemaForm driven by PROJECT_CREATE_FIELDS.
                Adding/reordering/hiding a field on any tab is now purely a
                config/fields/project-create.ts edit; this JSX never changes. */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              <SchemaForm
                fields={PROJECT_CREATE_FIELDS}
                groups={PROJECT_CREATE_GROUPS}
                tab={createTab}
                form={form}
                onChange={(key, value) => setForm(prev => ({ ...prev, [key as keyof CreateForm]: value }))}
              />
              {/* Phase 7A — badges/tags, next to Description on the Basic tab.
                  Rendered manually since SchemaForm/FieldDef has no "tags" type. */}
              {createTab === "basic" && (
                <div className="space-y-1">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Badges / Tags</Label>
                  <BadgeTagInput
                    value={form.badges}
                    onChange={tags => setForm(prev => ({ ...prev, badges: tags }))}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-card-border px-6 py-4 flex gap-3 shrink-0">
              <div className="flex gap-1 flex-1 mr-2">
                {CREATE_TABS.map((t, i) => (
                  <div
                    key={t.id}
                    className={cn(
                      "flex-1 h-1 rounded-full transition-all",
                      i <= CREATE_TABS.findIndex(x => x.id === createTab)
                        ? "bg-primary"
                        : "bg-muted/40"
                    )}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                className="font-mono text-xs"
                onClick={() => {
                  const idx = CREATE_TABS.findIndex(t => t.id === createTab);
                  if (idx > 0) setCreateTab(CREATE_TABS[idx - 1].id);
                  else { setShowCreate(false); setForm(EMPTY_FORM); }
                }}
              >
                {createTab === "basic" ? "Cancel" : "Back"}
              </Button>
              {createTab !== "tutorial" ? (
                <Button
                  className="font-mono text-xs"
                  onClick={() => {
                    const idx = CREATE_TABS.findIndex(t => t.id === createTab);
                    setCreateTab(CREATE_TABS[idx + 1].id);
                  }}
                >
                  Next →
                </Button>
              ) : (
                <Button className="font-mono text-xs" onClick={handleCreate}>
                  Initialize Protocol
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by protocol name..."
              className="pl-9 font-mono bg-card border-card-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {catFilter !== "All" && (
            <button onClick={() => setCatFilter("All")} className="flex items-center gap-1 text-xs font-mono text-muted-foreground/50 hover:text-primary transition-colors">
              <X className="w-3 h-3" /> Clear filter
            </button>
          )}
        </div>
        {/* Category filter pills */}
        <div className="flex flex-wrap gap-1.5 pb-1">
          {PROJECT_CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)}
              className={cn("px-2.5 py-1 rounded-lg font-mono text-[10px] border transition-all",
                catFilter === cat
                  ? "border-primary/50 bg-primary/10 text-primary font-bold"
                  : "border-border/30 text-muted-foreground/50 hover:border-primary/20 hover:text-muted-foreground")}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {(() => {
        const allProjects = data?.projects ?? [];
        const projects = catFilter === "All" ? allProjects : allProjects.filter((p: any) => p.category === catFilter);
        return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-card border-card-border shadow-none">
              <CardHeader className="pb-2"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-4 w-1/2 mt-2" /></CardHeader>
              <CardContent><div className="space-y-2 mt-4"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /></div></CardContent>
              <CardFooter><Skeleton className="h-8 w-full" /></CardFooter>
            </Card>
          ))
        ) : projects.length === 0 ? (
          <div className="col-span-full py-12 text-center font-mono text-muted-foreground bg-card border border-card-border rounded-md">
            No active protocols in the database.{" "}
            <button onClick={() => setShowCreate(true)} className="text-primary hover:underline">Initialize one now.</button>
          </div>
        ) : (
          projects.map((project: any) => (
            <Card key={project.id} className="bg-card border-card-border shadow-none flex flex-col group hover:border-primary/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="font-mono font-bold truncate pr-2 text-primary">{project.name}</CardTitle>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase rounded-sm border-primary/30">Tier {project.tier}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs font-mono text-muted-foreground truncate">Funding: ${project.fundingAmount?.toLocaleString() ?? 0}</div>
                  {(project as any).xpName && (
                    <Badge variant="outline" className="font-mono text-[9px] uppercase border-yellow-500/30 text-yellow-400 bg-yellow-400/5 flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" />{(project as any).xpName}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{project.description ?? "No data provided."}</p>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-background/50 rounded p-2 border border-border">
                    <div className="text-muted-foreground mb-1 uppercase">Operators</div>
                    <div className="font-bold">{project.activeUserCount ?? 0}</div>
                  </div>
                  <div className="bg-background/50 rounded p-2 border border-border">
                    <div className="text-muted-foreground mb-1 uppercase">Tasks</div>
                    <div className="font-bold">{project.taskCount ?? 0}</div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-0 flex gap-2">
                <Link href={`/admin/projects/${project.id}`} className="flex-1">
                  <Button variant="outline" className="w-full font-mono text-xs uppercase bg-transparent border-card-border hover:bg-primary/10 hover:text-primary">
                    <Activity className="h-3 w-3 mr-2" /> Details
                  </Button>
                </Link>
                {project.websiteUrl && (
                  <Button variant="ghost" size="icon" className="border border-card-border hover:bg-primary/10 hover:text-primary" onClick={() => window.open(project.websiteUrl!, "_blank")}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))
        )}
      </div>
        );
      })()}
    </div>
  );
}
