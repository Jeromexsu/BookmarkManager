import { build, context } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outdir = join(root, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// Runs on every build, including each incremental rebuild under --watch (esbuild's `define`
// is fixed at context-creation time, so it can't refresh per rebuild — a source file that's
// rewritten in onStart and then imported normally does).
const buildTimePlugin = {
  name: "build-time",
  setup(pluginBuild) {
    pluginBuild.onStart(async () => {
      const content = `export const BUILD_TIME = ${JSON.stringify(new Date().toISOString())};\n`;
      await writeFile(join(root, "src/generated/buildTime.ts"), content);
    });
  },
};

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
  plugins: [buildTimePlugin],
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
