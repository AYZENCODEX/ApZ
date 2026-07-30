import { useState } from "react";
import { useListVaultEntries, customFetch } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  Shield, Eye, EyeOff, Copy, Check, Save,
  Wallet, Loader2, AlertTriangle, Zap, Link,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useWalletConnect } from "@/hooks/use-wallet-connect";

type EntryAny = any;

function SeedPhraseCard({ entry }: { entry: EntryAny }) {
  const [seed, setSeed] = useState("");
  const [revealedSeed, setRevealedSeed] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    const words = seed.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24 && !seed.trim().startsWith("0x")) {
      toast({ variant: "destructive", title: "Invalid format", description: "Expected 12/24 seed words or a 0x private key" });
      return;
    }
    setSaving(true);
    try {
      await customFetch(`/vault/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ seedPhrase: seed.trim() }),
      });
      toast({ title: "Seed phrase saved", description: "Encrypted and stored securely" });
      entry.hasSeedPhrase = true;
      setSeed("");
    } catch {
      toast({ variant: "destructive", title: "Failed to save seed phrase" });
    } finally { setSaving(false); }
  };

  const handleReveal = async () => {
    setRevealing(true);
    try {
      const d = await customFetch<{ seedPhrase: string }>(`/vault/${entry.id}/seed`);
      setRevealedSeed(d.seedPhrase);
      setShown(true);
    } catch {
      toast({ variant: "destructive", title: "Failed to decrypt seed phrase" });
    } finally { setRevealing(false); }
  };

  const handleCopy = async () => {
    const val = revealedSeed ?? seed;
    if (!val) return;
    await navigator.clipboard.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const wallets: string[] = Array.isArray(entry.walletAddresses)
    ? entry.walletAddresses
    : typeof entry.walletAddresses === "string" && entry.walletAddresses
      ? entry.walletAddresses.split("\n").filter(Boolean)
      : [];

  return (
    <div className="bg-card border border-card-border rounded-xl p-4 space-y-3 hover:border-primary/20 transition-all">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <Shield className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-xs font-bold text-foreground">{entry.projectName}</p>
          <p className="font-mono text-[9px] text-muted-foreground/50">{entry.category} · {entry.entitySerial}</p>
        </div>
        <Badge
          variant="outline"
          className={cn("font-mono text-[9px] border flex-shrink-0",
            entry.hasSeedPhrase
              ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20"
              : "text-muted-foreground/50 bg-muted/10"
          )}
        >
          {entry.hasSeedPhrase ? "✓ Seed Stored" : "No Seed"}
        </Badge>
      </div>

      {/* Wallet addresses */}
      {wallets.length > 0 && (
        <div className="space-y-1">
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/40">Wallet Addresses</p>
          {wallets.map((w, i) => (
            <div key={i} className="flex items-center gap-2 bg-muted/10 rounded-lg px-2.5 py-1.5 border border-border/20">
              <Wallet className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />
              <span className="font-mono text-[10px] text-foreground/70 flex-1 truncate">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Seed phrase section */}
      {entry.hasSeedPhrase ? (
        <div className="space-y-2">
          {revealedSeed ? (
            <>
              <div className={cn("font-mono text-xs bg-muted/20 rounded-lg p-3 border border-border/30 break-all leading-relaxed", !shown && "blur-sm select-none")}>
                {revealedSeed}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShown(s => !s)} className="font-mono text-xs gap-1.5 flex-1">
                  {shown ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {shown ? "Hide" : "Show"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopy} className={cn("font-mono text-xs gap-1.5 flex-1", copied ? "text-emerald-400 border-emerald-400/30" : "")}>
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex items-center gap-1.5 p-2 bg-amber-400/5 border border-amber-400/20 rounded-lg">
                <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                <p className="font-mono text-[9px] text-amber-400">Never share your seed phrase with anyone</p>
              </div>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReveal}
              disabled={revealing}
              className="font-mono text-xs gap-1.5 w-full"
            >
              {revealing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
              Reveal Seed Phrase
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={seed}
            onChange={e => setSeed(e.target.value)}
            className="font-mono text-xs bg-input resize-none h-20 placeholder:text-muted-foreground/30"
            placeholder="Enter 12 or 24 seed words separated by spaces, or a 0x private key..."
          />
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !seed.trim()}
            className="font-mono text-xs gap-1.5 w-full"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Encrypt & Save
          </Button>
        </div>
      )}
    </div>
  );
}

function WalletConnectPanel() {
  const { state: wc, connect, sendTransaction, hasMetaMask } = useWalletConnect();
  const { toast } = useToast();
  const [toAddr, setToAddr] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  const handleConnect = async () => {
    const addr = await connect();
    if (!addr) toast({ variant: "destructive", title: wc.error ?? "Wallet connection failed" });
  };

  const handleSend = async () => {
    if (!toAddr || !amount) return;
    setSending(true);
    try {
      if (!wc.address) { toast({ variant: "destructive", title: "Connect a wallet first" }); return; }
      const txHash = await sendTransaction(toAddr, amount, wc.address);
      if (txHash) toast({ title: "Transaction sent", description: txHash.slice(0, 20) + "..." });
      else toast({ variant: "destructive", title: "Transaction failed" });
    } finally { setSending(false); }
  };

  return (
    <div className="bg-card border border-primary/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        <span className="font-mono text-xs font-bold text-primary">Real-Time Wallet Connect</span>
        <Badge variant="outline" className="font-mono text-[9px] ml-auto">MetaMask</Badge>
      </div>

      {!wc.isConnected ? (
        <div className="space-y-3">
          <p className="font-mono text-[10px] text-muted-foreground/60">
            Connect your MetaMask wallet to interact with your entities and sign transactions in real-time.
          </p>
          {!hasMetaMask && (
            <div className="flex items-center gap-2 p-2.5 bg-amber-400/5 border border-amber-400/20 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <p className="font-mono text-[9px] text-amber-400">MetaMask not detected. Install the browser extension first.</p>
            </div>
          )}
          <Button onClick={handleConnect} disabled={wc.isConnecting || !hasMetaMask} className="font-mono text-xs gap-1.5 w-full">
            {wc.isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />}
            {wc.isConnecting ? "Connecting..." : "Connect MetaMask"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2.5 bg-emerald-400/5 border border-emerald-400/20 rounded-lg">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[9px] text-emerald-400 font-bold">Connected</p>
              <p className="font-mono text-[9px] text-muted-foreground/60 truncate">{wc.address}</p>
            </div>
            {wc.chainId && (
              <Badge variant="outline" className="font-mono text-[9px]">Chain {wc.chainId}</Badge>
            )}
          </div>

          <div className="space-y-2">
            <p className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest">Send ETH</p>
            <input
              value={toAddr}
              onChange={e => setToAddr(e.target.value)}
              className="w-full font-mono text-xs bg-input border border-border rounded-lg px-3 py-2 h-8 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
              placeholder="0x recipient address..."
            />
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full font-mono text-xs bg-input border border-border rounded-lg px-3 py-2 h-8 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/50"
              placeholder="Amount in ETH (e.g. 0.001)"
            />
            <Button
              onClick={handleSend}
              disabled={sending || !toAddr || !amount}
              className="font-mono text-xs gap-1.5 w-full"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Send Transaction
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VaultWalletSeed() {
  const { data, isLoading } = useListVaultEntries();
  const entries: EntryAny[] = (data as EntryAny[] | undefined) ?? [];

  const withSeed = entries.filter(e => e.hasSeedPhrase).length;
  const withWallet = entries.filter(e => {
    const w = Array.isArray(e.walletAddresses) ? e.walletAddresses : [];
    return w.length > 0;
  }).length;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Entities", value: entries.length, color: "text-primary" },
          { label: "With Seed Phrase", value: withSeed, color: "text-emerald-400" },
          { label: "With Wallet", value: withWallet, color: "text-violet-400" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-card-border rounded-xl p-3 text-center">
            <p className={cn("font-mono text-xl font-bold", s.color)}>{s.value}</p>
            <p className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Live wallet connect */}
      <WalletConnectPanel />

      {/* Entity seed phrases */}
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/40 px-1">
          Entity Seed Phrases
        </p>
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground/50 font-mono text-xs">
            No entities · Add entities to manage seed phrases
          </div>
        ) : (
          entries.map(e => <SeedPhraseCard key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}
