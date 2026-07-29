import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validateReferenceMarkdown } from "./reference-markdown-validation.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = join(repositoryRoot, "reference");

const collectMarkdownFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectMarkdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return files.flat();
};

const files = await collectMarkdownFiles(referenceRoot);
const errors = (
  await Promise.all(
    files.map(async (path) => {
      const content = await readFile(path, "utf8");
      const sourcePath = relative(repositoryRoot, path).split(sep).join("/");
      return validateReferenceMarkdown(content, {
        isMoveDocument: sourcePath.startsWith("reference/moves/"),
      }).map(({ line, message }) => `${sourcePath}:${line}: ${message}`);
    }),
  )
).flat();

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(`Validated ${files.length} reference Markdown files.`);
