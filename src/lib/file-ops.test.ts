import { describe, it, expect } from "vitest";
import {
  OPENABLE_EXTS,
  badgeLabel,
  extOfName,
  fileKind,
  fileMetaLine,
  fileTone,
  filesStoragePath,
  formatBytes,
  isOpenable,
  rejectFileReason,
  FILE_MAX_BYTES,
} from "./file-ops";

describe("extOfName", () => {
  it("lowercases and strips the dot", () => {
    expect(extOfName("Report.PDF")).toBe("pdf");
    expect(extOfName("a.b.docx")).toBe("docx");
  });
  it("returns empty for a name with no usable extension", () => {
    expect(extOfName("Makefile")).toBe("");
    expect(extOfName(".gitignore")).toBe("");
    expect(extOfName("trailing.")).toBe("");
  });
});

describe("badgeLabel never blank", () => {
  it("uppercases and truncates unknown extensions to four characters", () => {
    expect(badgeLabel("thing.sketchfile")).toBe("SKET");
    expect(badgeLabel("deck.key")).toBe("KEY");
  });
  it("falls back to FILE with no extension", () => {
    expect(badgeLabel("Makefile")).toBe("FILE");
  });
});

describe("type mapping uses existing palette pairs", () => {
  it("maps pdf, docx, csv, png, zip, pptx and unknown", () => {
    expect(fileKind("a.pdf")).toBe("doc");
    expect(fileTone("a.pdf")).toEqual({ tint: "dangerTint", ink: "danger" });
    expect(fileTone("a.docx")).toEqual({ tint: "blueTint", ink: "blueInk" });
    expect(fileTone("a.md")).toEqual({ tint: "sunken", ink: "secondary" });
    expect(fileKind("a.xlsx")).toBe("sheet");
    expect(fileTone("a.csv")).toEqual({ tint: "accentTint", ink: "accent" });
    expect(fileKind("a.png")).toBe("image");
    expect(fileTone("a.svg")).toEqual({ tint: "purpleTint", ink: "purple" });
    expect(fileKind("a.zip")).toBe("zip");
    expect(fileTone("a.zip")).toEqual({ tint: "amberTint", ink: "amberInk" });
    expect(fileTone("a.pptx")).toEqual({ tint: "pinkTint", ink: "pink" });
    expect(fileKind("a.weird")).toBe("generic");
    expect(fileTone("a.weird")).toEqual({ tint: "sunken", ink: "secondary" });
  });
});

describe("Open allowlist", () => {
  it("holds exactly the browser-displayable formats", () => {
    expect([...OPENABLE_EXTS]).toEqual([
      "pdf",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "txt",
      "md",
      "csv",
    ]);
  });
  it("excludes docx, xlsx, zip, key and pptx", () => {
    for (const n of ["a.docx", "a.xlsx", "a.zip", "a.key", "a.pptx", "a.doc"])
      expect(isOpenable(n)).toBe(false);
    for (const n of ["a.pdf", "a.MD", "a.csv"]) expect(isOpenable(n)).toBe(true);
  });
});

describe("formatBytes", () => {
  it("B under 1 KB, KB under 1 MB, one decimal MB above", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 512)).toBe("512 KB");
    expect(formatBytes(2.3 * 1024 * 1024)).toBe("2.3 MB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });
});

describe("rejectFileReason validates SIZE, not type", () => {
  it("accepts a huge-mime oddity under the ceiling", () => {
    expect(rejectFileReason({ size: FILE_MAX_BYTES })).toBeNull();
  });
  it("rejects over 25 MB with the link-it-instead copy", () => {
    expect(rejectFileReason({ size: FILE_MAX_BYTES + 1 })).toBe(
      "That file is over 25 MB — link it instead.",
    );
  });
});

describe("filesStoragePath", () => {
  it("puts the page id in the SECOND segment, under a files prefix", () => {
    const p = filesStoragePath("ws", "pg", "uuid", "pdf");
    expect(p).toBe("ws/pg/files/uuid.pdf");
    expect(p.split("/")[1]).toBe("pg");
  });
  it("omits the dot when there is no extension", () => {
    expect(filesStoragePath("ws", "pg", "uuid", "")).toBe("ws/pg/files/uuid");
  });
});

describe("fileMetaLine", () => {
  it("joins size, author and time with middots", () => {
    expect(fileMetaLine(2.3 * 1024 * 1024, "Priya", "4d ago")).toBe(
      "2.3 MB · added by Priya · 4d ago",
    );
  });
  it("omits unknown segments", () => {
    expect(fileMetaLine(1024)).toBe("1 KB");
    expect(fileMetaLine(1024, null, "now")).toBe("1 KB · now");
  });
});
