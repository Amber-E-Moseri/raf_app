import { useCallback, useEffect, useState } from "react";
import type { DependencyList, Dispatch, SetStateAction } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  reload: () => Promise<void>;
  setData: Dispatch<SetStateAction<T | null>>;
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: DependencyList = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const next = await loader();
      setData(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, isLoading, reload, setData };
}
