import { useQuery } from "@tanstack/react-query";
import { apiMe, type Me } from "@/lib/modulesApi";

export function useMe() {
  return useQuery<Me>({
    queryKey: ["/me"],
    queryFn: apiMe,
    staleTime: 1000 * 60,
  });
}
