import { useState, useEffect } from "react";
import { Mail, CheckCircle, AlertCircle, Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface EmailStatus {
  ayzenEmail: string | null;
  domain: string;
  cfConfigured: boolean;
  zoneFound: boolean;
}

export default function AyzenEmail() {
  const { toast } = useToast();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [username, setUsername] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const token = () => localStorage.getItem("ayzen_token") ?? "";

  useEffect(() => {
    fetch("/api/ayzen-email/status", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoadingStatus(false));
  }, []);

  const checkUsername = async () => {
    if (!username.trim()) return;
    setChecking(true);
    setAvailability(null);
    try {
      const res = await fetch(`/api/ayzen-email/check/${encodeURIComponent(username.trim())}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setAvailability(data);
    } catch {
      setAvailability({ available: false, reason: "Check failed" });
    }
    setChecking(false);
  };

  const claimEmail = async () => {
    if (!username.trim() || !forwardTo.trim() || !availability?.available) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/ayzen-email/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ username: username.trim(), forwardTo: forwardTo.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "AYZEN Email Claimed!", description: `${data.ayzenEmail} is now yours.` });
        setStatus((s) => s ? { ...s, ayzenEmail: data.ayzenEmail } : s);
        setUsername("");
        setForwardTo("");
        setAvailability(null);
      } else {
        toast({ variant: "destructive", title: "Failed", description: data.error ?? "Could not claim email" });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message ?? "Network error" });
    }
    setClaiming(false);
  };

  const copyEmail = () => {
    if (status?.ayzenEmail) {
      navigator.clipboard.writeText(status.ayzenEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold font-mono tracking-tighter uppercase">AYZEN Email</h1>
        <p className="text-muted-foreground font-mono text-sm">Claim your personal <span className="text-primary">username@ayzen.tech</span> address</p>
      </div>

      {/* Current email */}
      {status?.ayzenEmail ? (
        <Card className="bg-card border-card-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-sm uppercase tracking-wider text-primary flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Active AYZEN Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded p-4">
              <Mail className="w-5 h-5 text-primary shrink-0" />
              <span className="font-mono text-lg font-bold text-primary flex-1">{status.ayzenEmail}</span>
              <Button variant="ghost" size="icon" onClick={copyEmail} className="shrink-0">
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <div className="text-xs font-mono text-muted-foreground space-y-1">
              <p>✓ All emails sent to this address are forwarded to your inbox via Cloudflare Email Routing.</p>
              <p>✓ Use this address for airdrop registrations to keep your real email private.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card border-card-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="font-mono text-sm uppercase tracking-wider flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" /> Claim Your Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* System check */}
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className={`flex items-center gap-2 p-2 rounded border ${status?.cfConfigured ? "border-green-500/30 text-green-400" : "border-yellow-500/30 text-yellow-400"}`}>
                {status?.cfConfigured ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                Cloudflare API
              </div>
              <div className={`flex items-center gap-2 p-2 rounded border ${status?.zoneFound ? "border-green-500/30 text-green-400" : "border-yellow-500/30 text-yellow-400"}`}>
                {status?.zoneFound ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                ayzen.tech Zone
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Username</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    placeholder="yourname"
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); setAvailability(null); }}
                    onKeyDown={(e) => e.key === "Enter" && checkUsername()}
                    className="bg-input border-border font-mono focus-visible:ring-primary/50 focus-visible:border-primary pr-28"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">@ayzen.tech</span>
                </div>
                <Button variant="outline" onClick={checkUsername} disabled={checking || !username.trim()} className="font-mono text-xs">
                  {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : "Check"}
                </Button>
              </div>
              {availability && (
                <div className={`flex items-center gap-2 text-xs font-mono ${availability.available ? "text-green-400" : "text-red-400"}`}>
                  {availability.available ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {availability.available ? `${username}@ayzen.tech is available!` : (availability.reason ?? "Username not available")}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Forward Emails To</Label>
              <Input
                type="email"
                placeholder="your.real@email.com"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className="bg-input border-border font-mono focus-visible:ring-primary/50 focus-visible:border-primary"
              />
              <p className="text-[10px] font-mono text-muted-foreground">Emails sent to your AYZEN address will be forwarded here.</p>
            </div>

            <Button
              className="w-full font-mono uppercase text-xs tracking-wider"
              disabled={!availability?.available || !forwardTo.trim() || claiming}
              onClick={claimEmail}
            >
              {claiming ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim Address"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Info card */}
      <Card className="bg-card border-card-border shadow-none">
        <CardContent className="pt-4 space-y-3 text-xs font-mono text-muted-foreground">
          <h3 className="text-foreground font-bold uppercase tracking-wider text-[10px]">How It Works</h3>
          <div className="space-y-2">
            <div className="flex gap-3">
              <span className="text-primary shrink-0">01</span>
              <span>Choose a unique username to create <span className="text-foreground">username@ayzen.tech</span></span>
            </div>
            <div className="flex gap-3">
              <span className="text-primary shrink-0">02</span>
              <span>Cloudflare Email Routing forwards all incoming mail to your real inbox</span>
            </div>
            <div className="flex gap-3">
              <span className="text-primary shrink-0">03</span>
              <span>Use your AYZEN address for airdrops, Discord, and Web3 sign-ups — protect your real email</span>
            </div>
          </div>
          <a href="https://developers.cloudflare.com/email-routing/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline mt-2">
            Cloudflare Email Routing docs <ExternalLink className="w-3 h-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
