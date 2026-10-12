import { useQuery } from "@tanstack/react-query";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/lib/queryKeys";

/** Discovery only; instance administration APIs remain the authority. */
export function useInstanceAdminAccess() {
  const query = useQuery({
    queryKey: queryKeys.access.currentBoardAccess,
    queryFn: () => accessApi.getCurrentBoardAccess(),
    retry: false,
    staleTime: 30_000,
  });
  return {
    canManageInstance: !query.isError && (query.data?.source === "local_implicit" || query.data?.isInstanceAdmin === true),
    loading: query.isPending,
    error: query.isError,
    retry: query.refetch,
    retrying: query.isFetching,
  };
}
