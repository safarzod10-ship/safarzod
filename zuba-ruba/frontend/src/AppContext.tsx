import { createContext, useContext } from "react";
import type { Config, Me } from "./types";

export interface AppState {
  me: Me;
  config: Config;
  setMe: (me: Me) => void;
  refreshConfig: () => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppContext is not provided");
  return value;
}
