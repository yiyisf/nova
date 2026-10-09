import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { createLocalExecutionEnv } from "./local.ts";

describe("local execution env (UNSAFE fallback)", () => {
  it("reads and writes workspace files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-sandbox-"));
    try {
      const env = await createLocalExecutionEnv(dir);
      const written = await env.writeFile("hello.txt", "hi from nova", BACKGROUND_CONTEXT);
      expect(written.ok).toBe(true);
      const read = await env.readTextFile("hello.txt", BACKGROUND_CONTEXT);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value).toBe("hi from nova");
      expect(await readFile(join(dir, "hello.txt"), "utf8")).toBe("hi from nova");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("executes a shell command in the workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-sandbox-"));
    try {
      const env = await createLocalExecutionEnv(dir);
      let stdout = "";
      const result = await env.exec("echo sandbox-ok", {
        onOutput: (text, _ctx, info) => {
          if (info.stream === "stdout") stdout += text;
        },
      }, BACKGROUND_CONTEXT);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.exitCode).toBe(0);
      expect(stdout).toContain("sandbox-ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
