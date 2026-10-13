import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function normalizePackMetadata(metadata: unknown, output: string) {
  const row = Array.isArray(metadata)
    ? metadata[0]
    : metadata && typeof metadata === "object"
      ? Object.values(metadata)[0]
      : undefined;
  if (!row || typeof row !== "object" || typeof (row as { filename?: unknown }).filename !== "string" || !Array.isArray((row as { files?: unknown }).files)) {
    throw new Error(`Unexpected npm pack output from ${packageRoot}: ${output}`);
  }
  return row as { filename: string; files: Array<{ path: string }> };
}

function readPackMetadata(packDestination: string) {
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  return normalizePackMetadata(JSON.parse(output), output);
}

describe("npm pack metadata compatibility", () => {
  it.each([
    ["legacy array", [{ filename: "legacy.tgz", files: [] }], "legacy.tgz"],
    ["npm 12 keyed object", { "@paperclipai/skills-catalog": { filename: "npm12.tgz", files: [] } }, "npm12.tgz"],
  ])("normalizes %s output", (_label, metadata, filename) => {
    expect(normalizePackMetadata(metadata, JSON.stringify(metadata)).filename).toBe(filename);
  });

  it.each([null, {}, [], { package: {} }, [{ files: [] }], "invalid"])(
    "rejects invalid npm pack metadata %j",
    metadata => expect(() => normalizePackMetadata(metadata, JSON.stringify(metadata))).toThrow("Unexpected npm pack output"),
  );
});

describe("skills catalog package artifacts", () => {
  const cleanup: string[] = [];

  function createPackDestination() {
    const destination = mkdtempSync(path.join(tmpdir(), "paperclip-skills-catalog-pack-"));
    cleanup.push(destination);
    return destination;
  }

  afterEach(async () => {
    await Promise.all(cleanup.map((entry) => rm(entry, { force: true, recursive: true })));
    cleanup.length = 0;
  });

  it("packs dist manifest and catalog files for npm artifact consumers", () => {
    let metadata = readPackMetadata(createPackDestination());

    if (!metadata.files.some((entry) => entry.path === "dist/generated/catalog.json")) {
      execFileSync("pnpm", ["--filter", "@paperclipai/skills-catalog", "build"], {
        cwd: packageRoot,
        stdio: "ignore",
      });
      metadata = readPackMetadata(createPackDestination());
    }

    const paths = metadata.files.map((entry) => entry.path);

    expect(paths).toContain("dist/generated/catalog.json");
    expect(paths).toContain("generated/catalog.json");
    expect(paths).toContain("catalog/bundled/software-development/github-pr-workflow/SKILL.md");
    expect(paths).toContain("catalog/optional/browser/agent-browser/SKILL.md");
    expect(paths).toContain("package.json");
  }, 120_000);
});
