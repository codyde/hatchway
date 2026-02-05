'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from '@/lib/auth-client';
import { Loader2 } from 'lucide-react';

/**
 * Inner component that uses useSearchParams - must be wrapped in Suspense
 */
function GitHubConnectContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    // Prevent double-triggering
    if (isRedirecting) return;
    setIsRedirecting(true);

    const returnUrl = searchParams.get('returnUrl') || '/';
    const visibility = searchParams.get('visibility') || 'public';
    const projectId = searchParams.get('projectId') || '';

    // Build the callback URL with our pending action params
    const callbackURL = `${returnUrl}?github_connect_pending=true&projectId=${encodeURIComponent(projectId)}&visibility=${encodeURIComponent(visibility)}`;

    // Use signIn.oauth2 to trigger GitHub OAuth
    // In local mode this will "sign in" as GitHub user - we don't care,
    // we just want the token stored in the accounts table
    signIn.oauth2({
      providerId: 'github',
      callbackURL,
    }).catch((err) => {
      console.error('Failed to initiate GitHub OAuth:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to GitHub');
      setIsRedirecting(false);
    });
  }, [searchParams, isRedirecting]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-center p-8 max-w-md">
          <h1 className="text-xl font-semibold text-red-400 mb-4">
            Failed to Connect GitHub
          </h1>
          <p className="text-zinc-400 mb-6">{error}</p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
          >
            Go Back
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-white mb-2">
          Connecting to GitHub
        </h1>
        <p className="text-zinc-400">
          Redirecting you to GitHub for authorization...
        </p>
      </div>
    </div>
  );
}

/**
 * Loading fallback for Suspense
 */
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-white mb-2">
          Loading...
        </h1>
      </div>
    </div>
  );
}

/**
 * Client-side page that triggers GitHub OAuth flow using Better Auth's client SDK.
 * This ensures proper state handling (stored in database) for the OAuth flow.
 * 
 * The pending action is already stored in a cookie by /api/auth/github/connect
 * before redirecting here.
 */
export default function GitHubConnectPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <GitHubConnectContent />
    </Suspense>
  );
}
