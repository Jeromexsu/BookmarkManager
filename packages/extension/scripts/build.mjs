import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outdir = join(root, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const buildOptions = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    "popup/popup": join(root, "src/popup/popup.ts"),
    options: join(root, "src/options.ts"),
  },
  outdir,
  bundle: true,
  format: "esm",
  target: "firefox115",
  sourcemap: true,
};

async function copyStatic() {
  await cp(join(root, "public"), outdir, { recursive: true });
}

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  await copyStatic();
  console.log("Watching extension source for changes...");
} else {
  await build(buildOptions);
  await copyStatic();
  console.log("Extension built to dist/");
}
