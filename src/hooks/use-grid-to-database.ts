import { createContext, useContext } from "react";
import { useCreatePage, useDeletePage } from "@/hooks/use-page-mutations";
import { useCreateProperty } from "@/hooks/use-property-mutations";
import type { GridToDatabasePlan } from "@/lib/table-to-database";

/** Make the database a grid becomes: the database page inside `hostId`,
 *  one text property per column, one row per line, in order (each row is
 *  made after the one before, so "created" keeps the grid's order).
 *  Resolves to the database id and the property keys, in column order. */
type GridToDatabase = {
  run: (hostId: string, plan: GridToDatabasePlan) => Promise<{ databaseId: string; keys: string[] }>;
  remove: (id: string) => void;
};

/* Given to the editor by the page (which has the data layer), so a table
 * block works anywhere without one: no provider, no "Turn into database". */
export const GridToDatabaseCtx = createContext<GridToDatabase | null>(null);

export function useGridToDatabase(): GridToDatabase | null {
  return useContext(GridToDatabaseCtx);
}

export function useGridToDatabaseImpl(): GridToDatabase {
  const create = useCreatePage();
  const createProperty = useCreateProperty();
  const del = useDeletePage();
  const run = async (
    hostId: string,
    plan: GridToDatabasePlan,
  ): Promise<{ databaseId: string; keys: string[] }> => {
    const db = await create.mutateAsync({
      seedProps: {},
      parentId: hostId,
      isDatabase: true,
      quiet: true,
      title: "",
    });
    try {
      const keys: string[] = [];
      for (const label of plan.labels) {
        const def = await createProperty.mutateAsync({ databaseId: db.id, label, type: "text" });
        keys.push(def.key);
      }
      for (const r of plan.records) {
        const seed: Record<string, unknown> = {};
        r.values.forEach((v, i) => {
          if (v) seed[keys[i]] = v;
        });
        await create.mutateAsync({ seedProps: seed, parentId: db.id, title: r.title, quiet: true });
      }
      return { databaseId: db.id, keys };
    } catch (err) {
      // Half a database is worse than none: take it away again.
      del.mutate(db.id);
      throw err;
    }
  };
  return { run, remove: (id: string) => del.mutate(id) };
}
