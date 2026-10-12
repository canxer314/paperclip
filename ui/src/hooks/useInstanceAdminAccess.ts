import { useQuery } from "@tanstack/react-query";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";

/** Discovery only; instance administration APIs remain the authority. */
export function useInstanceAdminAccess(): boolean | undefined {
  const { data, isPending } = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 30_000,
  });
  if (isPending) return undefined;
  return data?.source === "local_implicit" || data?.isInstanceAdmin === true;
}
