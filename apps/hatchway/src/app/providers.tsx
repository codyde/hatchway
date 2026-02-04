'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { type ReactNode } from 'react';

/**
 * Global QueryClient instance
 * Exported so it can be used by TanStack DB collections at module level
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds - data is considered fresh for 30s
      refetchOnWindowFocus: true, // Refetch when user returns to tab
      refetchOnReconnect: true, // Refetch when internet connection restored
      retry: 1, // Only retry failed requests once
      retryDelay: (attemptIndex) =>
        Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff, max 10s
    },
    mutations: {
      retry: 0, // Don't retry mutations by default
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
