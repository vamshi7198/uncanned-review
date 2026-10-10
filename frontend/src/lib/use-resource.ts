"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { errorMessage } from "./api";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (prev: T | null) => T | null) => void;
}

interface State<T> {
  key: string;
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Loads data on mount and whenever `key` changes; ignores stale responses. */
export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const loader = useRef(load);
  useLayoutEffect(() => {
    loader.current = load;
  });
  const seq = useRef(0);
  const [state, setState] = useState<State<T>>({ key, data: null, error: null, loading: true });

  // A new key means different data: drop the old result during render rather
  // than briefly showing it.
  if (state.key !== key) {
    setState({ key, data: null, error: null, loading: true });
  }

  const fetchInto = useCallback((k: string): Promise<void> => {
    const mine = ++seq.current;
    return loader.current().then(
      (data) => {
        if (mine === seq.current) setState({ key: k, data, error: null, loading: false });
      },
      (e) => {
        if (mine === seq.current) {
          setState((s) => ({ ...s, key: k, error: errorMessage(e), loading: false }));
        }
      },
    );
  }, []);

  useEffect(() => {
    void fetchInto(key);
  }, [key, fetchInto]);

  // Unlike a key change, a reload keeps the current data visible meanwhile.
  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null, loading: true }));
    return fetchInto(key);
  }, [key, fetchInto]);

  const setData = useCallback(
    (fn: (prev: T | null) => T | null) => setState((s) => ({ ...s, data: fn(s.data) })),
    [],
  );

  return { data: state.data, error: state.error, loading: state.loading, reload, setData };
}
