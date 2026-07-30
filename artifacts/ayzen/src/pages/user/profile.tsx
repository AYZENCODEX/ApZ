import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Camera, Twitter, Globe, MessageCircle, Edit3, Save, X,
  Trophy, Zap, FolderGit2, CheckSquare, User, Link2,
  Sparkles, Shield, Star,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileData {
  id: number;
  username: string;
  email: string;
  role: string;
  status: string;
  avatarUrl: string | null;
  bio: string | null;
  twitterHandle: string | null;
  discordHandle: string | null;
  websiteUrl: string | null;
  telegramHandle: string | null;
  totalRoi: number;
  streak: number;
  longestStreak: number;
  projectCount: number;
  tasksCompleted: number;
  createdAt: string;
}

function AnimatedCounter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (end === 0) { setDisplay(0); return; }
    const duration = 1200;
    const step = end / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [value]);
  return <span>{display.toLocaleString()}{suffix}</span>;
}

function Particle({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: 3, height: 3,
        background: "hsl(180 100% 45% / 0.6)",
        animation: `particle-drift ${4 + Math.random() * 4}s ease-in-out infinite`,
        ...style,
      }}
    />
  );
}

export default function ProfilePage() {
  const { user, token } = useAuth() as any;
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [form, setForm] = useState({
    username: "",
    bio: "",
    twitterHandle: "",
    discordHandle: "",
    websiteUrl: "",
    telegramHandle: "",
    avatarUrl: "",
  });

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      const data = await res.json();
      setProfile(data);
      setForm({
        username: data.username ?? "",
        bio: data.bio ?? "",
        twitterHandle: data.twitterHandle ?? "",
        discordHandle: data.discordHandle ?? "",
        websiteUrl: data.websiteUrl ?? "",
        telegramHandle: data.telegramHandle ?? "",
        avatarUrl: data.avatarUrl ?? "",
      });
      setAvatarPreview(data.avatarUrl ?? null);
    } catch {
      toast({ title: "Failed to load profile", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [token, toast]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 2MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      // Resize via canvas to 256×256 JPEG
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext("2d")!;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        setAvatarPreview(dataUrl);
        setForm(f => ({ ...f, avatarUrl: dataUrl }));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated = await res.json();
      setProfile(prev => prev ? { ...prev, ...updated } : null);
      setEditing(false);
      toast({ title: "Profile updated", description: "Changes saved successfully." });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (profile) {
      setForm({
        username: profile.username ?? "",
        bio: profile.bio ?? "",
        twitterHandle: profile.twitterHandle ?? "",
        discordHandle: profile.discordHandle ?? "",
        websiteUrl: profile.websiteUrl ?? "",
        telegramHandle: profile.telegramHandle ?? "",
        avatarUrl: profile.avatarUrl ?? "",
      });
      setAvatarPreview(profile.avatarUrl ?? null);
    }
    setEditing(false);
  };

  const particles = Array.from({ length: 12 }, (_, i) => ({
    top: `${10 + Math.random() * 80}%`,
    left: `${5 + Math.random() * 90}%`,
    animationDelay: `${i * 0.4}s`,
  }));

  const joinDate = profile
    ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-spin-slow" />
            <div className="absolute inset-2 rounded-full border border-primary/40 animate-spin-reverse" />
            <div className="absolute inset-4 rounded-full bg-primary/10 animate-glow-pulse" />
          </div>
          <p className="font-mono text-xs text-muted-foreground tracking-widest uppercase">Loading profile…</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const displayAvatar = avatarPreview || profile.avatarUrl;
  const initials = profile.username.slice(0, 2).toUpperCase();

  return (
    <div className="max-w-4xl mx-auto space-y-6 page-enter">

      {/* ── Hero Banner ─────────────────────────────────────────── */}
      <div className="relative rounded-xl overflow-hidden h-48 md:h-56">
        {/* Aurora background */}
        <div
          className="absolute inset-0 animate-aurora"
          style={{
            background: "linear-gradient(135deg, hsl(220 16% 7%), hsl(180 100% 12%), hsl(270 100% 10%), hsl(220 16% 7%))",
            backgroundSize: "300% 300%",
          }}
        />
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "linear-gradient(to right, hsl(180 100% 45%) 1px, transparent 1px), linear-gradient(to bottom, hsl(180 100% 45%) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        {/* Floating particles */}
        {particles.map((p, i) => (
          <Particle key={i} style={{ top: p.top, left: p.left, animationDelay: p.animationDelay }} />
        ))}
        {/* Gradient fade bottom */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-background to-transparent" />
        {/* Corner accent */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <div className="px-2 py-1 bg-primary/10 border border-primary/20 rounded text-[10px] font-mono text-primary tracking-widest uppercase">
            {profile.role}
          </div>
          {profile.status === "active" && (
            <div className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Online
            </div>
          )}
        </div>
        {/* Member since */}
        <div className="absolute bottom-6 right-4 text-[10px] font-mono text-muted-foreground/50 tracking-widest">
          MEMBER SINCE {joinDate.toUpperCase()}
        </div>
      </div>

      {/* ── Avatar + Name Row ────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 -mt-20 px-2 relative z-10">
        {/* Avatar */}
        <div className="relative group animate-fade-up">
          {/* Outer glow ring */}
          <div className="absolute -inset-1 rounded-full animate-glow-pulse opacity-60" />
          {/* Spinning border */}
          <div className="absolute -inset-2 rounded-full border border-primary/20 animate-spin-slow" />
          <div className="absolute -inset-3 rounded-full border border-secondary/10 animate-spin-reverse" />
          {/* Avatar */}
          <div className="relative w-28 h-28 rounded-full overflow-hidden border-2 border-primary/40 bg-card">
            {displayAvatar ? (
              <img src={displayAvatar} alt={profile.username} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/20">
                <span className="text-3xl font-mono font-bold text-primary">{initials}</span>
              </div>
            )}
            {/* Upload overlay */}
            {editing && (
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
              >
                <Camera className="w-5 h-5 text-primary" />
                <span className="text-[9px] font-mono text-primary uppercase tracking-wider">Upload</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
        </div>

        {/* Name + actions */}
        <div className="flex-1 flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-1 animate-fade-up delay-100">
          <div>
            {editing ? (
              <input
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                maxLength={30}
                className="bg-transparent border-b border-primary/40 text-2xl font-mono font-bold text-foreground focus:border-primary outline-none w-full max-w-xs transition-colors"
              />
            ) : (
              <h1 className="text-2xl md:text-3xl font-mono font-bold text-foreground tracking-tight">
                {profile.username}
              </h1>
            )}
            <p className="text-sm font-mono text-muted-foreground mt-0.5">{profile.email}</p>
          </div>

          {/* Edit / Save / Cancel */}
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={cancelEdit}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground font-mono text-sm hover:border-destructive/40 hover:text-destructive transition-all duration-200 hover-lift"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold hover:bg-primary/90 transition-all duration-200 hover-lift animate-glow-pulse disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 text-primary font-mono text-sm hover:bg-primary/10 hover:border-primary/60 transition-all duration-200 hover-lift hover-shimmer"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit Profile
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats Row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-fade-up delay-200">
        {[
          { icon: Zap, label: "Total ROI", value: profile.totalRoi, suffix: " $", color: "primary" },
          { icon: Star, label: "Streak", value: profile.streak, suffix: " days", color: "secondary" },
          { icon: FolderGit2, label: "Projects", value: profile.projectCount, suffix: "", color: "primary" },
          { icon: CheckSquare, label: "Tasks Done", value: profile.tasksCompleted, suffix: "", color: "secondary" },
        ].map(({ icon: Icon, label, value, suffix, color }, i) => (
          <div
            key={label}
            className={cn(
              "glass-card rounded-xl p-4 hover-lift hover-shimmer cursor-default",
              "border transition-all duration-300",
              `animate-fade-up delay-${(i + 2) * 100}`
            )}
          >
            <div className={cn("flex items-center gap-2 mb-3", color === "primary" ? "text-primary" : "text-secondary")}>
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
            </div>
            <div className={cn("text-2xl font-mono font-bold", color === "primary" ? "text-primary" : "text-secondary")}>
              <AnimatedCounter value={value} suffix={suffix} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Bio ──────────────────────────────────────────────────── */}
      <div className="glass-card rounded-xl p-5 hover-glow transition-all duration-300 border animate-fade-up delay-300">
        <div className="flex items-center gap-2 mb-3">
          <User className="w-4 h-4 text-primary" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">About</span>
        </div>
        {editing ? (
          <div className="relative">
            <textarea
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value.slice(0, 300) }))}
              placeholder="Describe yourself — your strategy, chains you operate on, goals…"
              rows={4}
              className="w-full bg-input/50 border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground resize-none focus:border-primary/60 outline-none transition-colors"
            />
            <span className="absolute bottom-2 right-3 text-[10px] font-mono text-muted-foreground/40">
              {form.bio.length}/300
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground font-mono leading-relaxed">
            {profile.bio || (
              <span className="text-muted-foreground/30 italic">No bio yet — click Edit Profile to add one.</span>
            )}
          </p>
        )}
      </div>

      {/* ── Social Links ─────────────────────────────────────────── */}
      <div className="glass-card rounded-xl p-5 border animate-fade-up delay-400">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-4 h-4 text-primary" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Social Links</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              key: "twitterHandle" as const,
              icon: Twitter,
              label: "Twitter / X",
              placeholder: "username",
              prefix: "x.com/",
              color: "text-sky-400",
              href: (v: string) => `https://x.com/${v}`,
            },
            {
              key: "discordHandle" as const,
              icon: MessageCircle,
              label: "Discord",
              placeholder: "username#0000",
              prefix: "",
              color: "text-indigo-400",
              href: null,
            },
            {
              key: "websiteUrl" as const,
              icon: Globe,
              label: "Website",
              placeholder: "https://yoursite.com",
              prefix: "",
              color: "text-emerald-400",
              href: (v: string) => v,
            },
            {
              key: "telegramHandle" as const,
              icon: MessageCircle,
              label: "Telegram",
              placeholder: "username",
              prefix: "t.me/",
              color: "text-cyan-400",
              href: (v: string) => `https://t.me/${v}`,
            },
          ].map(({ key, icon: Icon, label, placeholder, prefix, color, href }) => {
            const val = editing ? form[key] : profile[key];
            return (
              <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/50 hover-lift hover-glow group transition-all duration-200">
                <Icon className={cn("w-4 h-4 flex-shrink-0", color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider mb-0.5">{label}</p>
                  {editing ? (
                    <div className="flex items-center gap-1">
                      {prefix && <span className="text-xs font-mono text-muted-foreground/40">{prefix}</span>}
                      <input
                        value={form[key]}
                        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="flex-1 bg-transparent text-sm font-mono text-foreground border-b border-border focus:border-primary/60 outline-none transition-colors"
                      />
                    </div>
                  ) : val ? (
                    href ? (
                      <a
                        href={href(val)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn("text-sm font-mono truncate hover:underline transition-colors", color)}
                      >
                        {prefix}{val}
                      </a>
                    ) : (
                      <span className={cn("text-sm font-mono truncate", color)}>{val}</span>
                    )
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground/30 italic">Not set</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Achievements ─────────────────────────────────────────── */}
      <div className="glass-card rounded-xl p-5 border animate-fade-up delay-500">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Achievements</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Early Operator", icon: Shield, condition: true, color: "border-primary/30 text-primary bg-primary/5" },
            { label: "Streak 7+", icon: Zap, condition: profile.streak >= 7, color: "border-secondary/30 text-secondary bg-secondary/5" },
            { label: "Streak 30+", icon: Zap, condition: profile.streak >= 30, color: "border-amber-400/30 text-amber-400 bg-amber-400/5" },
            { label: "10+ Tasks", icon: CheckSquare, condition: profile.tasksCompleted >= 10, color: "border-emerald-400/30 text-emerald-400 bg-emerald-400/5" },
            { label: "50+ Tasks", icon: CheckSquare, condition: profile.tasksCompleted >= 50, color: "border-orange-400/30 text-orange-400 bg-orange-400/5" },
            { label: "Project Veteran", icon: FolderGit2, condition: profile.projectCount >= 5, color: "border-cyan-400/30 text-cyan-400 bg-cyan-400/5" },
            { label: "ROI 1K+", icon: Star, condition: profile.totalRoi >= 1000, color: "border-violet-400/30 text-violet-400 bg-violet-400/5" },
            { label: "Admin", icon: Shield, condition: profile.role === "admin", color: "border-red-400/30 text-red-400 bg-red-400/5" },
          ].map(({ label, icon: Icon, condition, color }) => (
            <div
              key={label}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-mono font-medium transition-all duration-300",
                condition ? cn(color, "hover-lift") : "border-border/20 text-muted-foreground/20 opacity-40 grayscale"
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Decorative bottom line ───────────────────────────────── */}
      <div className="flex items-center gap-4 py-2 animate-fade-up delay-600">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
        <span className="text-[10px] font-mono text-muted-foreground/30 tracking-widest">AYZEN PROTOCOL</span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </div>
    </div>
  );
}
