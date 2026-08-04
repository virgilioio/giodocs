import { describe, it, expect } from "vitest";
import {
  OPENABLE_EXTS,
  badgeLabel,
  displayFileName,
  extOfName,
  fileKind,
  fileMetaLine,
  fileTone,
  filesStoragePath,
  formatBytes,
  hasFileBlock,
  isOpenable,
  nameFromPath,
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
      "webp",
      "avif",
      "bmp",
      "ico",
      "txt",
      "md",
      "csv",
      "json",
      "xml",
      "html",
      "mp4",
      "webm",
      "mp3",
      "wav",
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

describe("hasFileBlock", () => {
  it("finds a file nested inside a callout inside a column", () => {
    const tree = [
      { type: "text" },
      {
        type: "columns",
        cols: [[{ type: "text" }], [{ type: "callout", children: [{ type: "file" }] }]],
      },
    ];
    expect(hasFileBlock(tree)).toBe(true);
  });
  it("is false for a tree with no file block", () => {
    expect(hasFileBlock([{ type: "image" }, { type: "columns", cols: [[{ type: "text" }]] }])).toBe(
      false,
    );
    expect(hasFileBlock(undefined)).toBe(false);
  });
});

describe("any file type is recognised", () => {
  it("maps images beyond the original five", () => {
    for (const n of ["a.webp", "a.avif", "a.heic", "a.bmp", "a.tiff", "a.ico"]) {
      expect(fileKind(n)).toBe("image");
      expect(fileTone(n).ink).toBe("purple");
    }
  });
  it("maps every common archive to the zip tile", () => {
    for (const n of ["a.zip", "a.rar", "a.7z", "a.tar", "a.gz", "a.tgz"]) {
      expect(fileKind(n)).toBe("zip");
      expect(fileTone(n).ink).toBe("amberInk");
    }
  });
  it("maps data and code to the code tile", () => {
    for (const n of ["a.json", "a.xml", "a.yaml", "a.sql", "a.ts", "a.css", "a.sh"]) {
      expect(fileKind(n)).toBe("code");
    }
  });
  it("maps media to video and audio tiles", () => {
    expect(fileKind("clip.mp4")).toBe("video");
    expect(fileKind("clip.webm")).toBe("video");
    expect(fileKind("take.mp3")).toBe("audio");
    expect(fileKind("take.wav")).toBe("audio");
  });
  it("gives design files the pink generic tile", () => {
    expect(fileKind("cover.psd")).toBe("generic");
    expect(fileTone("cover.psd").ink).toBe("pink");
  });
  it("still badges an unknown extension rather than blanking", () => {
    expect(fileKind("thing.wobble")).toBe("generic");
    expect(badgeLabel("thing.wobble")).toBe("WOBB");
  });
  it("opens only what a browser genuinely renders", () => {
    for (const n of ["a.webp", "a.json", "a.mp4", "a.mp3", "a.html"]) {
      expect(isOpenable(n)).toBe(true);
    }
    for (const n of ["a.heic", "a.psd", "a.zip", "a.docx", "a.pptx"]) {
      expect(isOpenable(n)).toBe(false);
    }
  });
});

describe("no card ever claims 0 B", () => {
  it("drops the size segment when the size is unknown", () => {
    expect(fileMetaLine(0, "Priya", "4d ago")).toBe("added by Priya · 4d ago");
    expect(fileMetaLine(0)).toBe("");
  });
});

describe("displayFileName", () => {
  it("prefers the stored name", () => {
    expect(displayFileName("Report.pdf", "ws/pg/files/u.pdf")).toBe("Report.pdf");
  });
  it("falls back to the path's extension when the name was lost", () => {
    expect(displayFileName("", "ws/pg/files/u.pdf")).toBe("File.pdf");
    expect(displayFileName(undefined, "ws/pg/files/u.zip")).toBe("File.zip");
  });
  it("never renders empty", () => {
    expect(displayFileName(null, null)).toBe("File");
  });
});

describe("nameFromPath", () => {
  it("takes the last segment", () => {
    expect(nameFromPath("ws/pg/files/u.pdf")).toBe("u.pdf");
    expect(nameFromPath(null)).toBe("");
  });
});
