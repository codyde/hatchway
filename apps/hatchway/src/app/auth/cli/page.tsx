"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { signIn, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Loader2, Github, CheckCircle2, XCircle } from "lucide-react";

type AuthState = "loading" | "login" | "authenticating" | "success" | "error";

function CLIAuthContent() {
  const searchParams = useSearchParams();
  const sessionToken = searchParams.get("session");
  const { data: session, isPending: isSessionLoading } = useSession();
  
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);
  const [isSentryLoading, setIsSentryLoading] = useState(false);

  const completeAuth = async () => {
    if (!sessionToken) return;
    
    setAuthState("authenticating");
    
    try {
      const response = await fetch("/api/auth/cli/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to complete authentication");
      }

      const data = await response.json();
      
      // Redirect to the CLI callback
      if (data.callbackUrl) {
        setAuthState("success");
        // Small delay to show success state before redirect
        setTimeout(() => {
          window.location.href = data.callbackUrl;
        }, 1500);
      } else {
        throw new Error("No callback URL received");
      }
    } catch (err) {
      console.error("Auth completion error:", err);
      setAuthState("error");
      setError(err instanceof Error ? err.message : "Authentication failed");
    }
  };

  // Check if we have a valid session token
  useEffect(() => {
    if (!sessionToken) {
      setAuthState("error");
      setError("Invalid authentication link. Please try again from the CLI.");
      return;
    }
    
    // If we're still loading the session, wait
    if (isSessionLoading) {
      return;
    }

    // If user is already logged in, complete the auth immediately
    if (session?.user) {
      completeAuth();
    } else {
      setAuthState("login");
    }
  }, [sessionToken, session, isSessionLoading]);

  const handleGitHubLogin = async () => {
    setIsGitHubLoading(true);
    setError(null);
    try {
      await signIn.oauth2({
        providerId: "github",
        callbackURL: `/auth/cli?session=${sessionToken}`,
      });
    } catch (err) {
      console.error("GitHub OAuth error:", err);
      setError("Failed to initiate GitHub login. Please try again.");
      setIsGitHubLoading(false);
    }
  };

  const handleSentryLogin = async () => {
    setIsSentryLoading(true);
    setError(null);
    try {
      await signIn.oauth2({
        providerId: "sentry",
        callbackURL: `/auth/cli?session=${sessionToken}`,
      });
    } catch (err) {
      console.error("Sentry OAuth error:", err);
      setError("Failed to initiate Sentry login. Please try again.");
      setIsSentryLoading(false);
    }
  };

  return (
    <>
      {/* Card */}
      <div className="bg-[#1f2335] border border-[#7aa2f7]/30 rounded-xl p-8 shadow-2xl shadow-[#7aa2f7]/5">
        {authState === "loading" && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[#7aa2f7] mb-4" />
            <p className="text-[#a9b1d6]">Checking authentication...</p>
          </div>
        )}

        {authState === "login" && (
          <>
            <p className="text-[#a9b1d6] text-center mb-8">
              Choose a sign-in method to authorize the CLI
            </p>

            {/* OAuth Buttons */}
            <div className="space-y-4">
              <Button
                onClick={handleGitHubLogin}
                disabled={isGitHubLoading || isSentryLoading}
                className="w-full h-12 bg-[#24283b] hover:bg-[#414868] border border-[#7aa2f7]/30 text-white font-medium rounded-lg transition-all duration-200"
              >
                {isGitHubLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-3" />
                ) : (
                  <Github className="h-5 w-5 mr-3" />
                )}
                Continue with GitHub
              </Button>

              <Button
                onClick={handleSentryLogin}
                disabled={isGitHubLoading || isSentryLoading}
                className="w-full h-12 bg-[#24283b] hover:bg-[#414868] border border-[#7aa2f7]/30 text-white font-medium rounded-lg transition-all duration-200"
              >
                {isSentryLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-3" />
                ) : (
                  <Image
                    src="/sentryglyph.png"
                    alt="Sentry"
                    width={20}
                    height={20}
                    className="mr-3"
                  />
                )}
                Continue with Sentry
              </Button>
            </div>

            {error && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </>
        )}

        {authState === "authenticating" && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-10 w-10 animate-spin text-[#7aa2f7] mb-4" />
            <p className="text-white font-medium text-lg">Creating runner token...</p>
            <p className="text-[#565f89] text-sm mt-2">Please wait</p>
          </div>
        )}

        {authState === "success" && (
          <div className="flex flex-col items-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-10 w-10 text-green-400" />
            </div>
            <p className="text-white font-medium text-lg">Authentication successful!</p>
            <p className="text-[#565f89] text-sm mt-2">
              Redirecting back to CLI...
            </p>
            <p className="text-[#414868] text-xs mt-6">
              You can close this window after the redirect completes.
            </p>
          </div>
        )}

        {authState === "error" && (
          <div className="flex flex-col items-center py-8">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
              <XCircle className="h-10 w-10 text-red-400" />
            </div>
            <p className="text-white font-medium text-lg">Authentication failed</p>
            <p className="text-red-400 text-sm mt-2 text-center">
              {error || "An unknown error occurred"}
            </p>
            <p className="text-[#414868] text-xs mt-6">
              Please close this window and try again from the CLI.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 text-center">
        <p className="text-[#565f89] text-xs leading-relaxed">
          This page was opened by the Hatchway CLI.
          <br />
          Only sign in if you initiated this from your terminal.
        </p>
      </div>
    </>
  );
}

function LoadingFallback() {
  return (
    <>
      <div className="bg-[#1f2335] border border-[#7aa2f7]/30 rounded-xl p-8 shadow-2xl shadow-[#7aa2f7]/5">
        <div className="flex flex-col items-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-[#7aa2f7] mb-4" />
          <p className="text-[#a9b1d6]">Loading...</p>
        </div>
      </div>
      <div className="mt-8 text-center">
        <p className="text-[#565f89] text-xs leading-relaxed">
          This page was opened by the Hatchway CLI.
          <br />
          Only sign in if you initiated this from your terminal.
        </p>
      </div>
    </>
  );
}

export default function CLIAuthPage() {
  return (
    <div className="min-h-screen bg-[#1a1b26] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header with Logo */}
        <div className="text-center mb-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div 
              className="flex h-16 w-16 items-center justify-center rounded-2xl p-2 border border-white/20 shadow-lg shadow-[#7aa2f7]/20"
              style={{ background: 'linear-gradient(to bottom right, #7aa2f7, #bb9af7)' }}
            >
              <img
                src="/icon-192.png"
                alt="Hatchway"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
          
          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Hatchway
          </h1>
          <p className="text-[#7aa2f7] font-medium mb-1">
            CLI Authentication
          </p>
          <p className="text-[#565f89] text-sm">
            Sign in to connect your CLI to your account
          </p>
        </div>

        <Suspense fallback={<LoadingFallback />}>
          <CLIAuthContent />
        </Suspense>
      </div>
    </div>
  );
}
