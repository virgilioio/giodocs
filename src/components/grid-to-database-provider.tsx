import type { ReactNode } from "react";
import { GridToDatabaseCtx, useGridToDatabaseImpl } from "@/hooks/use-grid-to-database";

/** Lets table blocks on this page turn into databases (see the hook). */
export function GridToDatabaseProvider({ children }: { children: ReactNode }) {
  return <GridToDatabaseCtx.Provider value={useGridToDatabaseImpl()}>{children}</GridToDatabaseCtx.Provider>;
}
