import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Terminal, ArrowRight, Loader2, Mail, User, Eye, EyeOff, Sparkles, Check, RefreshCw, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SuccessAnimation } from "@/components/success-animation";

import { getApiBase } from "@/lib/api-base";
const BASE = getApiBase();


async function backendLogin(email: string, password: string): Promise<{ token: string; user: any } | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function backendRegister(username: string, email: string, password: string, emailOtp: string, refCode?: string): Promise<{ token: string; user: any; error?: string } | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password, emailOtp, ...(refCode ? { refCode } : {}) }),
    });
    const data = await res.json();
    if (!res.ok) return { token: "", user: null, error: data.error ?? "Registration failed" };
    return data;
  } catch {
    return null;
  }
}

function makeCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const ops = [
    { q: `${a} + ${b}`, ans: a + b },
    { q: `${a + b} − ${b}`, ans: a },
    { q: `${a} × ${b > 5 ? 2 : b}`, ans: a * (b > 5 ? 2 : b) },
  ];
  return ops[Math.floor(Math.random() * ops.length)];
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login: setAuthContext } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [refCode, setRefCode] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicCode, setMagicCode] = useState("");
  const [magicVerifyLoading, setMagicVerifyLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const [captcha, setCaptcha] = useState(makeCaptcha);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);

  // signup OTP flow
  const [signupStep, setSignupStep] = useState<"form" | "otp">("form");
  const [signupOtp, setSignupOtp] = useState("");
  const [signupSendingOtp, setSignupSendingOtp] = useState(false);
  const [signupCountdown, setSignupCountdown] = useState(0);

  // signin OTP flow (2-step: credentials → email OTP)
  const [signinStep, setSigninStep] = useState<"form" | "otp">("form");
  const [signinOtp, setSigninOtp] = useState("");
  const [signinCountdown, setSigninCountdown] = useState(0);
  const [tempSigninData, setTempSigninData] = useState<{ token: string; user: any } | null>(null);
  const [signinOtpSending, setSigninOtpSending] = useState(false);
  const [signinOtpLoading, setSigninOtpLoading] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(false);

  useEffect(() => {
    if (signupCountdown <= 0) return;
    const t = setTimeout(() => setSignupCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [signupCountdown]);

  useEffect(() => {
    if (signinCountdown <= 0) return;
    const t = setTimeout(() => setSigninCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [signinCountdown]);

  const handleSendSignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) {
      toast({ variant: "destructive", title: "Fill all fields", description: "Username, email and password are required." });
      return;
    }
    if (password.length < 6) {
      toast({ variant: "destructive", title: "Password too short", description: "Minimum 6 characters." });
      return;
    }
    if (parseInt(captchaInput) !== captcha.ans) {
      setCaptchaError(true);
      setCaptcha(makeCaptcha());
      setCaptchaInput("");
      toast({ variant: "destructive", title: "Captcha failed" });
      return;
    }
    setCaptchaError(false);
    setSignupSendingOtp(true);
    try {
      const res = await fetch(`${BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Code sent!", description: `6-digit code sent to ${email}` });
        setSignupStep("otp");
        setSignupCountdown(60);
      } else {
        toast({ variant: "destructive", title: "Failed to send code", description: data.error ?? "Try again." });
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    }
    setSignupSendingOtp(false);
  };

  const handleResendSignupOtp = async () => {
    if (signupCountdown > 0) return;
    setSignupSendingOtp(true);
    try {
      const res = await fetch(`${BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        toast({ title: "Code resent!" });
        setSignupCountdown(60);
      }
    } catch {}
    setSignupSendingOtp(false);
  };


  const handleMagicVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magicCode.trim()) return;
    setMagicVerifyLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/magic-link/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: magicCode.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setAuthContext(data.user, data.token);
        setSuccessMsg(`Access granted, ${data.user.username}!`);
        setShowSuccess(true);
        setTimeout(() => {
          if (data.user.role === "admin") setLocation("/admin/dashboard");
          else setLocation("/dashboard");
        }, 1600);
      } else {
        toast({ variant: "destructive", title: data.error ?? "Invalid code" });
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    }
    setMagicVerifyLoading(false);
  };

  const DEMO_EMAILS = ["demoadmin@ayzen.io", "demo@ayzen.io"];

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const data = await backendLogin(email, password);
      if (data) {
        // Demo accounts: skip OTP entirely
        if (DEMO_EMAILS.includes(email.toLowerCase().trim())) {
          setAuthContext(data.user, data.token, keepSignedIn);
          setSuccessMsg(`Welcome back, ${data.user.username}!`);
          setShowSuccess(true);
          setTimeout(() => {
            if (data.user.role === "admin") setLocation("/admin/dashboard");
            else setLocation("/dashboard");
          }, 1600);
          setLoading(false);
          return;
        }
        // Step 1: credentials valid — send OTP
        setTempSigninData(data);
        setSigninOtpSending(true);
        try {
          const otpRes = await fetch(`${BASE}/api/auth/send-otp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const otpData = await otpRes.json();
          if (otpRes.ok) {
            toast({ title: "Code sent!", description: `Verification code sent to ${email}` });
            setSigninStep("otp");
            setSigninCountdown(60);
          } else {
            toast({ variant: "destructive", title: "Failed to send code", description: otpData.error ?? "Try again." });
          }
        } catch {
          toast({ variant: "destructive", title: "Connection error sending OTP" });
        }
        setSigninOtpSending(false);
      } else {
        toast({ variant: "destructive", title: "Access denied", description: "Invalid credentials. Check email and password." });
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error", description: "Could not reach server. Try again." });
    }
    setLoading(false);
  };

  const handleSigninOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signinOtp.trim() || signinOtp.length !== 6 || !tempSigninData) return;
    setSigninOtpLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: signinOtp.trim() }),
      });
      const result = await res.json();
      if (res.ok && result.valid) {
        setAuthContext(tempSigninData.user, tempSigninData.token, keepSignedIn);
        setSuccessMsg(`Welcome back, ${tempSigninData.user.username}!`);
        setShowSuccess(true);
        setTimeout(() => {
          if (tempSigninData.user.role === "admin") setLocation("/admin/dashboard");
          else setLocation("/dashboard");
        }, 1600);
      } else {
        toast({ variant: "destructive", title: result.error ?? "Invalid code" });
        setSigninOtp("");
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    }
    setSigninOtpLoading(false);
  };

  const handleResendSigninOtp = async () => {
    if (signinCountdown > 0) return;
    setSigninOtpSending(true);
    try {
      const res = await fetch(`${BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) { toast({ title: "Code resent!" }); setSigninCountdown(60); }
    } catch {}
    setSigninOtpSending(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupOtp.trim() || signupOtp.length !== 6) {
      toast({ variant: "destructive", title: "Enter the 6-digit code" });
      return;
    }
    setLoading(true);
    try {
      const data = await backendRegister(username, email, password, signupOtp.trim());
      if (!data) {
        toast({ variant: "destructive", title: "Registration failed", description: "Server error. Try again." });
        setLoading(false);
        return;
      }
      if (data.error) {
        toast({ variant: "destructive", title: "Registration failed", description: data.error });
        if (data.error.toLowerCase().includes("code")) setSignupOtp("");
        setLoading(false);
        return;
      }
      setAuthContext(data.user, data.token);
      setSuccessMsg("Welcome to AYZEN, Operator!");
      setShowSuccess(true);
      setTimeout(() => setLocation("/dashboard"), 1800);
    } catch {
      toast({ variant: "destructive", title: "Registration failed", description: "Try again." });
    }
    setLoading(false);
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast({ variant: "destructive", title: "Enter your email" }); return; }
    setMagicLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: data.error ?? "Failed to send magic link" });
      } else {
        setMagicSent(true);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to send magic link" });
    }
    setMagicLoading(false);
  };

  const handleDemoAdmin = async () => {
    setLoading(true);
    const data = await backendLogin("demoadmin@ayzen.io", "Demo@1234");
    if (data) {
      setAuthContext(data.user, data.token);
      setSuccessMsg(`Welcome, ${data.user.username}!`);
      setShowSuccess(true);
      setTimeout(() => setLocation("/admin/dashboard"), 1600);
    } else {
      toast({ variant: "destructive", title: "Demo admin login failed" });
    }
    setLoading(false);
  };

  const handleDemoDev = async () => {
    setLoading(true);
    const data = await backendLogin("demodev@ayzen.io", "Demo@1234");
    if (data) {
      setAuthContext(data.user, data.token);
      setSuccessMsg(`Welcome, ${data.user.username}!`);
      setShowSuccess(true);
      setTimeout(() => setLocation("/admin/developer"), 1600);
    } else {
      toast({ variant: "destructive", title: "Demo developer login failed" });
    }
    setLoading(false);
  };

  const handleDemoModerator = async () => {
    setLoading(true);
    const data = await backendLogin("demomod@ayzen.io", "Demo@1234");
    if (data) {
      setAuthContext(data.user, data.token);
      setSuccessMsg(`Welcome, ${data.user.username}!`);
      setShowSuccess(true);
      setTimeout(() => setLocation("/dashboard"), 1600);
    } else {
      toast({ variant: "destructive", title: "Demo moderator login failed" });
    }
    setLoading(false);
  };

  const handleDemoTeamLeader = async () => {
    setLoading(true);
    const data = await backendLogin("demoteam@ayzen.io", "Demo@1234");
    if (data) {
      setAuthContext(data.user, data.token);
      setSuccessMsg(`Welcome, ${data.user.username}!`);
      setShowSuccess(true);
      setTimeout(() => setLocation("/teams"), 1600);
    } else {
      toast({ variant: "destructive", title: "Demo team leader login failed" });
    }
    setLoading(false);
  };

  const handleDemoUser = async () => {
    setLoading(true);
    const data = await backendLogin("demo@ayzen.io", "Demo@1234");
    if (data) {
      setAuthContext(data.user, data.token);
      setSuccessMsg(`Welcome, ${data.user.username}!`);
      setShowSuccess(true);
      setTimeout(() => setLocation("/dashboard"), 1600);
    } else {
      toast({ variant: "destructive", title: "Demo user login failed" });
    }
    setLoading(false);
  };

  const isLoading = loading;

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <SuccessAnimation
        show={showSuccess}
        message={tab === "signup" ? "Account Created!" : "Access Granted!"}
        subMessage={successMsg}
        type={tab === "signup" ? "success" : "login"}
      />
      <div className="absolute inset-0 z-0 opacity-[0.02]"
        style={{ backgroundImage: "linear-gradient(to right, #808080 1px, transparent 1px), linear-gradient(to bottom, #808080 1px, transparent 1px)", backgroundSize: "40px 40px" }}
      />

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center border border-primary/20 shadow-[0_0_20px_rgba(0,255,255,0.08)]">
              <Terminal className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-mono font-bold tracking-tighter text-foreground mb-2">AYZEN</h1>
          <p className="text-muted-foreground font-mono text-xs uppercase tracking-[0.3em]">Airdrop Command Center</p>
        </div>

        <div className="bg-card border border-card-border p-8 shadow-2xl relative">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" />

          <div className="flex mb-6 border border-border rounded overflow-hidden">
            <button
              onClick={() => setTab("signin")}
              className={`flex-1 py-2 text-xs font-mono uppercase tracking-widest transition-colors ${tab === "signin" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >Sign In</button>
            <button
              onClick={() => setTab("signup")}
              className={`flex-1 py-2 text-xs font-mono uppercase tracking-widest transition-colors ${tab === "signup" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >Sign Up</button>
            <button
              onClick={() => { setTab("magic"); setMagicSent(false); }}
              className={`flex-1 py-2 text-xs font-mono uppercase tracking-widest transition-colors flex items-center justify-center gap-1 ${tab === "magic" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            ><Sparkles className="w-3 h-3" /> Magic</button>
          </div>

          {tab === "magic" ? (
            <div className="space-y-4">
              {magicSent ? (
                <div className="space-y-4">
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
                    <div className="font-mono text-xs text-muted-foreground">Code sent to</div>
                    <div className="font-mono text-sm text-foreground font-bold">{email}</div>
                  </div>
                  <form onSubmit={handleMagicVerify} className="space-y-4">
                    <div className="space-y-2">
                      <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Enter 6-Digit Code</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder="000000"
                        maxLength={6}
                        value={magicCode}
                        onChange={e => setMagicCode(e.target.value.replace(/\D/g, ""))}
                        className="bg-input border-border font-mono h-14 text-center text-2xl tracking-[0.5em] focus-visible:ring-primary/50"
                        autoFocus required
                      />
                    </div>
                    <Button type="submit" disabled={magicCode.length !== 6 || magicVerifyLoading} className="w-full h-11 font-mono font-bold uppercase tracking-widest">
                      {magicVerifyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="flex items-center gap-2">Verify & Enter <Sparkles className="w-4 h-4" /></span>}
                    </Button>
                  </form>
                  <Button variant="ghost" size="sm" className="w-full font-mono text-xs text-muted-foreground" onClick={() => { setMagicSent(false); setMagicCode(""); setEmail(""); }}>
                    ← Try different email
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleMagicLink} className="space-y-4">
                  <div className="text-center pb-2">
                    <div className="flex justify-center mb-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-primary" />
                      </div>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      Enter your email — we'll send you a 6-digit code. No password needed.
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input type="email" placeholder="operator@command.io" value={email} onChange={e => setEmail(e.target.value)}
                        className="bg-input border-border font-mono h-11 pl-9 focus-visible:ring-primary/50 focus-visible:border-primary" required />
                    </div>
                  </div>
                  <Button type="submit" className="w-full h-11 font-mono font-bold uppercase tracking-widest" disabled={magicLoading}>
                    {magicLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="flex items-center gap-2">Send Code <Sparkles className="w-4 h-4" /></span>}
                  </Button>
                </form>
              )}
            </div>
          ) : tab === "signin" && signinStep === "otp" ? (
            <form onSubmit={handleSigninOtpVerify} className="space-y-4">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
                <Mail className="w-7 h-7 text-primary mx-auto mb-2" />
                <p className="font-mono text-xs text-muted-foreground">Verification code sent to</p>
                <p className="font-mono text-sm text-foreground font-bold">{email}</p>
                <p className="font-mono text-[10px] text-muted-foreground/60 mt-1">Check your inbox — code expires in 10 minutes</p>
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">6-Digit Code</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={signinOtp}
                  onChange={e => setSigninOtp(e.target.value.replace(/\D/g, ""))}
                  className="bg-input border-border font-mono h-14 text-center text-2xl tracking-[0.5em] focus-visible:ring-primary/50 focus-visible:border-primary"
                  autoFocus required
                />
              </div>
              <Button type="submit" disabled={signinOtpLoading || signinOtp.length !== 6}
                className="w-full h-11 font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90">
                {signinOtpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="flex items-center gap-2">Verify & Enter <ArrowRight className="w-4 h-4" /></span>}
              </Button>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => { setSigninStep("form"); setSigninOtp(""); setTempSigninData(null); }}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground underline">
                  ← Back to login
                </button>
                <button type="button" onClick={handleResendSigninOtp} disabled={signinCountdown > 0 || signinOtpSending}
                  className="font-mono text-xs text-primary disabled:opacity-40">
                  {signinOtpSending ? "Sending…" : signinCountdown > 0 ? `Resend in ${signinCountdown}s` : "Resend Code"}
                </button>
              </div>
            </form>
          ) : tab === "signup" && signupStep === "otp" ? (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
                <Check className="w-7 h-7 text-primary mx-auto mb-2" />
                <p className="font-mono text-xs text-muted-foreground">Verification code sent to</p>
                <p className="font-mono text-sm text-foreground font-bold">{email}</p>
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">6-Digit Code</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  maxLength={6}
                  value={signupOtp}
                  onChange={e => setSignupOtp(e.target.value.replace(/\D/g, ""))}
                  className="bg-input border-border font-mono h-14 text-center text-2xl tracking-[0.5em] focus-visible:ring-primary/50 focus-visible:border-primary"
                  autoFocus required
                />
              </div>
              <Button type="submit" disabled={loading || signupOtp.length !== 6}
                className="w-full h-11 font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="flex items-center gap-2">Create Account <ArrowRight className="w-4 h-4" /></span>}
              </Button>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => { setSignupStep("form"); setSignupOtp(""); }}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground underline">
                  ← Change details
                </button>
                <button type="button" onClick={handleResendSignupOtp} disabled={signupCountdown > 0 || signupSendingOtp}
                  className="font-mono text-xs text-primary disabled:opacity-40">
                  {signupSendingOtp ? "Sending…" : signupCountdown > 0 ? `Resend in ${signupCountdown}s` : "Resend Code"}
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={tab === "signin" ? handleSignIn : handleSendSignupOtp} className="space-y-4">
            {tab === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="username" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="operator_handle"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    className="bg-input border-border font-mono h-11 pl-9 focus-visible:ring-primary/50 focus-visible:border-primary"
                    required
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {tab === "signin" ? "Email / Identifier" : "Email"}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="operator@command.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-input border-border font-mono h-11 pl-9 focus-visible:ring-primary/50 focus-visible:border-primary"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Passphrase</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-input border-border font-mono h-11 pr-10 focus-visible:ring-primary/50 focus-visible:border-primary"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {tab === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="refCode" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  Referral Code <span className="text-muted-foreground/40">(optional)</span>
                </Label>
                <Input
                  id="refCode"
                  type="text"
                  placeholder="AYZNXXXXXX"
                  value={refCode}
                  onChange={e => setRefCode(e.target.value.toUpperCase())}
                  className="bg-input border-border font-mono h-11 focus-visible:ring-primary/50 focus-visible:border-primary uppercase placeholder:normal-case placeholder:text-muted-foreground"
                />
                {refCode && <p className="text-[10px] font-mono text-primary">✓ Referral code will be applied on registration</p>}
              </div>
            )}
            {tab === "signup" && (
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Security Check <span className="text-red-400">*</span>
                </Label>
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 bg-primary/5 border border-primary/20 rounded px-4 py-2 font-mono text-sm font-bold text-primary tracking-widest select-none">
                    {captcha.q} = ?
                  </div>
                  <Input
                    type="number"
                    value={captchaInput}
                    onChange={e => { setCaptchaInput(e.target.value); setCaptchaError(false); }}
                    placeholder="Answer"
                    className={`bg-input border-border font-mono h-11 focus-visible:ring-primary/50 focus-visible:border-primary ${captchaError ? "border-red-400/50" : ""}`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => { setCaptcha(makeCaptcha()); setCaptchaInput(""); setCaptchaError(false); }}
                    className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                    title="New question"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                {captchaError && <p className="font-mono text-[10px] text-red-400">Wrong answer. Try the new question.</p>}
              </div>
            )}

            {tab === "signin" && (
              <div className="flex items-center gap-2.5 py-1">
                <button
                  type="button"
                  onClick={() => setKeepSignedIn(p => !p)}
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${keepSignedIn ? "bg-primary border-primary" : "border-border bg-input"}`}
                >
                  {keepSignedIn && <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />}
                </button>
                <label className="font-mono text-[10px] text-muted-foreground cursor-pointer select-none" onClick={() => setKeepSignedIn(p => !p)}>
                  Keep me signed in
                </label>
              </div>
            )}
            <Button
              type="submit"
              className="w-full h-11 font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isLoading || signupSendingOtp}
            >
              {loading || signupSendingOtp ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  {tab === "signin" ? "Initialize" : <><Mail className="w-4 h-4" /> Send Code</>}
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
            {tab === "signin" && (
              <div className="text-right">
                <Link href="/forgot-password" className="font-mono text-[10px] text-muted-foreground hover:text-primary flex items-center justify-end gap-1">
                  <KeyRound className="w-3 h-3" /> Forgot password?
                </Link>
              </div>
            )}
          </form>
          )}

          <div className="mt-6 border-t border-border pt-5">
            <div className="text-[10px] font-mono text-center text-muted-foreground mb-3 uppercase tracking-widest">Demo Override</div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="font-mono text-xs h-9 border-border hover:border-primary/40 hover:text-primary" onClick={handleDemoAdmin} disabled={isLoading}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Admin Init"}
              </Button>
              <Button variant="outline" className="font-mono text-xs h-9 border-border hover:border-yellow-500/40 hover:text-yellow-400" onClick={handleDemoDev} disabled={isLoading}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Developer Init"}
              </Button>
              <Button variant="outline" className="font-mono text-xs h-9 border-border hover:border-orange-500/40 hover:text-orange-400" onClick={handleDemoModerator} disabled={isLoading}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Moderator Init"}
              </Button>
              <Button variant="outline" className="font-mono text-xs h-9 border-border hover:border-emerald-500/40 hover:text-emerald-400" onClick={handleDemoTeamLeader} disabled={isLoading}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Team Leader Init"}
              </Button>
            </div>
            <Button variant="outline" className="w-full font-mono text-xs h-9 mt-2 border-border hover:border-sky-500/40 hover:text-sky-400" onClick={handleDemoUser} disabled={isLoading}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "User Init"}
            </Button>
          </div>
        </div>

        <div className="text-center text-sm text-muted-foreground font-mono">
          {tab === "signin" ? (
            <>Unregistered entity?{" "}<button onClick={() => setTab("signup")} className="text-primary hover:underline">Request access</button></>
          ) : tab === "signup" ? (
            <>Already have access?{" "}<button onClick={() => setTab("signin")} className="text-primary hover:underline">Sign in</button></>
          ) : (
            <>Prefer password?{" "}<button onClick={() => setTab("signin")} className="text-primary hover:underline">Sign in</button></>
          )}
        </div>
      </div>
    </div>
  );
}
