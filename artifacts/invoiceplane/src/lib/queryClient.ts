import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 30, // 30 seconds - faster for paginated data
      gcTime: 1000 * 60 * 5, // 5 minutes (previously cacheTime)
      retry: 1,
      // Optimize for paginated queries - don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
  },
});
