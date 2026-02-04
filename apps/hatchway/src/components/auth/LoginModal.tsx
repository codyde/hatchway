"use client";

import { useState } from "react";
import Image from "next/image";
import { signIn, signUp } from "@/lib/auth-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, Lock, User, AlertCircle, ArrowLeft, Github } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Mode = "login" | "signup";
type AuthMethod = "sentry" | "email";

export function LoginModal({ open, onOpenChange, onSuccess }: LoginModalProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("sentry");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSentryLoading, setIsSentryLoading] = useState(false);
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setName("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (mode === "login") {
        const result = await signIn.email({
          email,
          password,
        });

        if (result.error) {
          setError(result.error.message || "Invalid email or password");
          return;
        }
      } else {
        // Validate password requirements
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          return;
        }

        if (!/[A-Z]/.test(password)) {
          setError("Password must contain at least one uppercase letter");
          return;
        }

        if (!/[a-z]/.test(password)) {
          setError("Password must contain at least one lowercase letter");
          return;
        }

        if (!/[0-9]/.test(password)) {
          setError("Password must contain at least one number");
          return;
        }

        const result = await signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
        });

        if (result.error) {
          setError(result.error.message || "Failed to create account");
          return;
        }
      }

      // Success - close modal and call callback
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error("Auth error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError(null);
  };

  const handleSentryLogin = async () => {
    setError(null);
    setIsSentryLoading(true);
    try {
      await signIn.oauth2({
        providerId: "sentry",
        callbackURL: "/",
      });
    } catch (err) {
      console.error("Sentry OAuth error:", err);
      setError("Failed to initiate Sentry login. Please try again.");
      setIsSentryLoading(false);
    }
  };

  const handleGitHubLogin = async () => {
    setError(null);
    setIsGitHubLoading(true);
    try {
      await signIn.oauth2({
        providerId: "github",
        callbackURL: "/",
      });
    } catch (err) {
      console.error("GitHub OAuth error:", err);
      setError("Failed to initiate GitHub login. Please try again.");
      setIsGitHubLoading(false);
    }
  };

  const handleBackToSentry = () => {
    setAuthMethod("sentry");
    setError(null);
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="text-xl text-white">
            {mode === "login" ? "Welcome back" : "Create an account"}
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {mode === "login"
              ? "Sign in to your account to continue"
              : "Sign up to start building with Hatchway"}
          </DialogDescription>
        </DialogHeader>

        {authMethod === "sentry" ? (
          <>
            {/* OAuth Provider Buttons */}
            <div className="mt-4 flex justify-center gap-4">
              {/* Sentry OAuth Button */}
              <button
                type="button"
                onClick={handleSentryLogin}
                disabled={isSentryLoading || isGitHubLoading || isLoading}
                className="w-16 h-16 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-700 hover:border-zinc-600 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sign in with Sentry"
              >
                {isSentryLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                ) : (
                  <Image
                    src="/sentryglyph.png"
                    alt="Sentry"
                    width={32}
                    height={32}
                    className="h-8 w-8"
                  />
                )}
              </button>

              {/* GitHub OAuth Button */}
              <button
                type="button"
                onClick={handleGitHubLogin}
                disabled={isSentryLoading || isGitHubLoading || isLoading}
                className="w-16 h-16 rounded-lg bg-zinc-950 hover:bg-zinc-900 border border-zinc-700 hover:border-zinc-600 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sign in with GitHub"
              >
                {isGitHubLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                ) : (
                  <Github className="h-8 w-8 text-white" />
                )}
              </button>
            </div>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-zinc-950 px-2 text-zinc-500">or</span>
              </div>
            </div>

            {/* Email/Password Button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setAuthMethod("email")}
              disabled={isSentryLoading || isGitHubLoading}
              className="w-full bg-transparent border-zinc-700 hover:bg-zinc-900 hover:border-zinc-600 text-zinc-300"
            >
              <Mail className="h-4 w-4 mr-2" />
              Email / Password
            </Button>
          </>
        ) : (
          <>
            {/* Back button */}
            <button
              type="button"
              onClick={handleBackToSentry}
              className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white transition-colors mt-2 mb-4"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in options
            </button>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <label
                    htmlFor="name"
                    className="text-sm font-medium text-zinc-300"
                  >
                    Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <Input
                      id="name"
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pl-10 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="email"
                  className="text-sm font-medium text-zinc-300"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-zinc-300"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <Input
                    id="password"
                    type="password"
                    placeholder={mode === "signup" ? "Min 8 characters" : "Enter your password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="pl-10 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
                  />
                </div>
                {mode === "signup" && (
                  <p className="text-xs text-zinc-500">
                    Must include uppercase, lowercase, and a number
                  </p>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full btn-theme-primary"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {mode === "login" ? "Signing in..." : "Creating account..."}
                  </>
                ) : mode === "login" ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={toggleMode}
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                {mode === "login" ? (
                  <>
                    Don&apos;t have an account?{" "}
                    <span className="text-theme-primary hover:text-theme-accent">Sign up</span>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <span className="text-theme-primary hover:text-theme-accent">Sign in</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {/* Error display for Sentry auth */}
        {authMethod === "sentry" && error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg mt-4">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
