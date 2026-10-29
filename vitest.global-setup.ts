import { execFileSync } from "node:child_process";

// Build dist once, before any test file starts. Test files run the built bins
// in dist/. tsup cleans dist first, so a rebuild during the run makes them fail.
export default function setup(): void {
  execFileSync("npx", ["tsup"], { stdio: "inherit" });
}
