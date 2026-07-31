/**
 * vault-enrollment-project.tsx
 * ─────────────────────────────────────────────
 * Enrollment → Project: lists all projects the user has entities enrolled in.
 * Click a project to expand and see which entities are in it; click an entity
 * to navigate to its full detail page.
 */
import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  FolderGit2, Shield, Loader2, ChevronRight,
  ChevronDown, CheckCircle2, Activity, XCircle,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { VaultSectionPage, VaultSectionEmptyState } from "@/components/layout/vault-sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface EnrolledProject {
  id: number;
  name: string;
  category: string | null;
  status: string | null;
  enrolled_count: number;
}

interface EnrolledEntity {
  id: number;
  project_name: string;
  category: string;
  entity_serial: string | null;
  status: string;
  twitter_username: string | null;
  discord_username: string | null;
  telegram_username: string | null;
  enrollment_status: string;
}

const STATUS_BADGE: Record<string, string> = {
  active:       "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
  completed:    "text-amber-400 border-amber-400/30 bg-amber-400/5",
  disqualified: "text-red-400 border-red-400/30 bg-red-400/5",
  banned:       "text-red-500 border-red-500/30 bg-red-500/5",
  cancelled:    "text-muted-foreground/40 border-border/30",
};

export default function VaultEnrollmentProject() {
  const [, navigate] = useLocation();
  const [projects, setProjects] = useState<EnrolledProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [entitiesMap, setEntitiesMap] = useState<Record<number, EnrolledEntity[]>>({});
  const [entitiesLoading, setEntitiesLoading] = useState<Record<number, boolean>>({});

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await customFetch<EnrolledProject[]>("/api/projects/enrolled");
      setProjects(Array.isArray(rows) ? rows : []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const toggleProject = async (projectId: number) => {
    if (expandedId === projectId) { setExpandedId(null); return; }
    setExpandedId(projectId);
    if (entitiesMap[projectId]) return; // already loaded

    setEntitiesLoading(prev => ({ ...prev, [projectId]: true }));
    try {
      const rows = await customFetch<EnrolledEntity[]>(`/api/projects/${projectId}/enrolled-entities`);
      setEntitiesMap(prev => ({ ...prev, [projectId]: Array.isArray(rows) ? rows : [] }));
    } catch {
      setEntitiesMap(prev => ({ ...prev, [projectId]: [] }));
    } finally {
      setEntitiesLoading(prev => ({ ...prev, [projectId]: false }));
    }
  };

  return (
    <VaultSectionPage
      title="Projects"
      description="Projects your entities are enrolled in — click to expand"
      icon={FolderGit2}
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <VaultSectionEmptyState
          icon={FolderGit2}
          title="No project enrollments"
          note="Enroll your entities into projects to see them here."
        />
      ) : (
        <div className="space-y-2">
          {projects.map(project => {
            const isExpanded = expandedId === project.id;
            const entities = entitiesMap[project.id] ?? [];
            const isLoadingEntities = entitiesLoading[project.id];

            return (
              <div
                key={project.id}
                className={cn(
                  "bg-card border rounded-xl overflow-hidden transition-all",
                  isExpanded ? "border-primary/30 shadow-sm" : "border-card-border"
                )}
              >
                {/* Project header — click to expand */}
                <button
                  onClick={() => toggleProject(project.id)}
                  className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-muted/10 transition-colors"
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                    isExpanded ? "bg-primary/20 border border-primary/30" : "bg-primary/10 border border-primary/10"
                  )}>
                    <FolderGit2 className={cn("w-4 h-4", isExpanded ? "text-primary" : "text-primary/60")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-bold text-foreground truncate">{project.name}</p>
                    <p className="font-mono text-[9px] text-muted-foreground/50">
                      {project.category ?? "Uncategorized"} · {project.enrolled_count} entit{project.enrolled_count === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("font-mono text-[9px] flex-shrink-0", STATUS_BADGE[project.status ?? "active"] ?? STATUS_BADGE.active)}
                  >
                    {project.status ?? "active"}
                  </Badge>
                  {isExpanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />}
                </button>

                {/* Expanded entity list */}
                {isExpanded && (
                  <div className="border-t border-border/30">
                    {isLoadingEntities ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      </div>
                    ) : entities.length === 0 ? (
                      <p className="px-4 py-4 font-mono text-[10px] text-muted-foreground/40 text-center">
                        No entities enrolled
                      </p>
                    ) : (
                      <div className="divide-y divide-border/20">
                        {entities.map(entity => {
                          const EnrollIcon =
                            entity.enrollment_status === "active" ? Activity :
                            entity.enrollment_status === "completed" ? CheckCircle2 :
                            XCircle;
                          return (
                            <button
                              key={entity.id}
                              onClick={() => navigate(`/vault/entity/${entity.id}`)}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/10 transition-colors text-left group"
                            >
                              <div className="w-7 h-7 rounded-md bg-muted/20 border border-border/30 flex items-center justify-center flex-shrink-0">
                                <Shield className="w-3.5 h-3.5 text-muted-foreground/50" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-mono text-[11px] font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                  {entity.project_name || `Entity #${entity.id}`}
                                </p>
                                <p className="font-mono text-[9px] text-muted-foreground/50 truncate">
                                  {entity.category}
                                  {entity.twitter_username ? ` · @${entity.twitter_username}` : ""}
                                  {entity.discord_username && !entity.twitter_username ? ` · ${entity.discord_username}` : ""}
                                  {entity.telegram_username && !entity.twitter_username && !entity.discord_username ? ` · @${entity.telegram_username}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <EnrollIcon className={cn(
                                  "w-3 h-3",
                                  entity.enrollment_status === "active" ? "text-emerald-400" :
                                  entity.enrollment_status === "completed" ? "text-amber-400" :
                                  "text-red-400/60"
                                )} />
                                <Badge
                                  variant="outline"
                                  className={cn("font-mono text-[8px]", STATUS_BADGE[entity.enrollment_status] ?? STATUS_BADGE.active)}
                                >
                                  {entity.enrollment_status}
                                </Badge>
                              </div>
                              <ChevronRight className="w-3 h-3 text-muted-foreground/20 group-hover:text-primary/40 flex-shrink-0 transition-colors" />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </VaultSectionPage>
  );
}
