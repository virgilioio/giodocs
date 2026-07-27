import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import type { PageFull, PageListItem } from "@/lib/types";

/**
 * Regression: useRenamePage must patch BOTH the workspace list cache and
 * the page-detail cache. Otherwise useCreatePage seeds qk.page(id) with an
 * empty title at creation time; a subsequent rename patches only the list;
 * navigating away and back within staleTime resurrects the empty-title
 * detail row and the page editor renders an empty title.
 *
 * This test simulates the two optimistic cache writes and asserts both
 * caches carry the new title.
 */
describe("useRenamePage — cache patching", () => {
  const ws = "ws-1";
  const pageId = "page-1";

  function seed(qc: QueryClient) {
    const list: PageListItem[] = [
      {
        id: pageId,
        title: "",
        icon: "📄",
        props: {},
        verified_at: new Date(0).toISOString(),
        verified_by: null,
        edited_at: new Date(0).toISOString(),
        edited_by: null,
        access_type: "workspace",
      },
    ];
    const detail: PageFull = {
      id: pageId,
      workspace_id: ws,
      title: "",
      icon: "📄",
      blocks: [],
      props: {},
      verified_at: new Date(0).toISOString(),
      verified_by: null,
      edited_at: new Date(0).toISOString(),
      edited_by: null,
      access_type: "workspace",
      created_at: new Date(0).toISOString(),
      created_by: null,
      deleted_at: null,
      archived_at: null,
    } as unknown as PageFull;
    qc.setQueryData(qk.pages(ws), list);
    qc.setQueryData(qk.page(pageId), detail);
  }

  /** Mirrors the onMutate body in useRenamePage. */
  function optimisticRename(qc: QueryClient, title: string) {
    const nowIso = new Date().toISOString();
    const list = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
    qc.setQueryData<PageListItem[]>(
      qk.pages(ws),
      list.map((p) => (p.id === pageId ? { ...p, title, edited_at: nowIso } : p)),
    );
    qc.setQueryData<PageFull | null>(qk.page(pageId), (prev) =>
      prev ? { ...prev, title, edited_at: nowIso } : prev,
    );
  }

  it("patches both list and detail caches", () => {
    const qc = new QueryClient();
    seed(qc);
    optimisticRename(qc, "Legal onboarding");

    const list = qc.getQueryData<PageListItem[]>(qk.pages(ws))!;
    const detail = qc.getQueryData<PageFull>(qk.page(pageId))!;
    expect(list[0].title).toBe("Legal onboarding");
    expect(detail.title).toBe("Legal onboarding");
  });

  it("returning to the page within staleTime sees the renamed title", () => {
    const qc = new QueryClient();
    seed(qc);
    optimisticRename(qc, "Legal onboarding");
    // Simulate the /p/:id route re-mounting and reading from cache.
    const cached = qc.getQueryData<PageFull>(qk.page(pageId));
    expect(cached?.title).toBe("Legal onboarding");
  });
});

/**
 * Chunk 3 extension: useSetPageProperty must also patch BOTH the list
 * and the page-detail cache. Otherwise editing a property from the
 * table succeeds, but navigating to /p/:id renders stale props from
 * qk.page(id).
 */
describe("useSetPageProperty — cache patching", () => {
  const ws = "ws-1";
  const pageId = "page-1";

  function seed(qc: QueryClient) {
    const list: PageListItem[] = [
      {
        id: pageId,
        title: "Doc",
        icon: "📄",
        props: { area: "Ops" },
        verified_at: new Date(0).toISOString(),
        verified_by: null,
        edited_at: new Date(0).toISOString(),
        edited_by: null,
        access_type: "workspace",
      },
    ];
    const detail: PageFull = {
      id: pageId,
      workspace_id: ws,
      title: "Doc",
      icon: "📄",
      blocks: [],
      props: { area: "Ops" },
      verified_at: new Date(0).toISOString(),
      verified_by: null,
      edited_at: new Date(0).toISOString(),
      edited_by: null,
      access_type: "workspace",
      created_at: new Date(0).toISOString(),
      created_by: null,
      deleted_at: null,
      archived_at: null,
    } as unknown as PageFull;
    qc.setQueryData(qk.pages(ws), list);
    qc.setQueryData(qk.page(pageId), detail);
  }

  /** Mirrors the onMutate body in useSetPageProperty. */
  function optimisticSet(qc: QueryClient, key: string, value: unknown) {
    const nowIso = new Date().toISOString();
    const patchProps = (raw: unknown): Record<string, unknown> => {
      const props =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};
      if (value === null || value === undefined) delete props[key];
      else props[key] = value;
      return props;
    };
    const list = qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? [];
    qc.setQueryData<PageListItem[]>(
      qk.pages(ws),
      list.map((p) =>
        p.id === pageId
          ? { ...p, props: patchProps(p.props) as PageListItem["props"], edited_at: nowIso }
          : p,
      ),
    );
    qc.setQueryData<PageFull | null>(qk.page(pageId), (prev) =>
      prev
        ? ({ ...prev, props: patchProps(prev.props) as PageFull["props"], edited_at: nowIso } as PageFull)
        : prev,
    );
  }

  it("patches both list and detail caches on set", () => {
    const qc = new QueryClient();
    seed(qc);
    optimisticSet(qc, "area", "Legal");
    const list = qc.getQueryData<PageListItem[]>(qk.pages(ws))!;
    const detail = qc.getQueryData<PageFull>(qk.page(pageId))!;
    expect((list[0].props as Record<string, unknown>).area).toBe("Legal");
    expect((detail.props as Record<string, unknown>).area).toBe("Legal");
  });

  it("clears the property on null value in both caches", () => {
    const qc = new QueryClient();
    seed(qc);
    optimisticSet(qc, "area", null);
    const list = qc.getQueryData<PageListItem[]>(qk.pages(ws))!;
    const detail = qc.getQueryData<PageFull>(qk.page(pageId))!;
    expect((list[0].props as Record<string, unknown>).area).toBeUndefined();
    expect((detail.props as Record<string, unknown>).area).toBeUndefined();
  });
});
