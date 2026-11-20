import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Runs named check groups inside one Playwright test. Each group is a
// `test.step` (when `step` is given), so reports and traces show it by name.
// GROUP_FILTER=<regexp> runs only matching groups, for debugging one group
// without editing code. Each group has a time limit: a stuck wait fails with
// the group's name and diagnostics instead of running until the test times out.
// `work` receives `mark(step)`; the last marked step is named in the error and
// the failure report, so a hang says where it stopped.
export function groupFilter(filter = process.env.GROUP_FILTER) {
  const pattern = filter ? new RegExp(filter) : null;
  return (name) => !pattern || pattern.test(name);
}

export function createGroupRunner({
  label,
  evidence,
  checks,
  getPage,
  errors = [],
  diagnose,
  limitMs = Number(process.env.BROWSER_GROUP_LIMIT_MS ?? 120_000),
  step = (_name, body) => body(),
  filter = process.env.GROUP_FILTER,
}) {
  const included = groupFilter(filter);
  let failures = 0;
  return async function run(name, work) {
    if (!included(name)) return;
    return step(name, () => runGroup(name, work));
  };
  async function runGroup(name, work) {
    const started = performance.now();
    const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
    const knownErrors = errors.length;
    let timer;
    let at = null;
    const mark = (step) => {
      at = step;
    };
    try {
      await Promise.race([
        work(mark),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${label} group exceeded ${limitMs / 1000}s: ${name}${at ? ` (at step: ${at})` : ""}`,
                ),
              ),
            limitMs,
          );
        }),
      ]);
    } catch (error) {
      clearTimeout(timer);
      console.log(`FAIL ${label}: ${name} (${seconds()}s)`);
      const prefix = join(evidence, `${label}-failure-${++failures}`);
      const report = {
        group: name,
        seconds: Number(seconds()),
        step: at,
        error: String(error?.stack ?? error),
        pageErrors: errors.slice(knownErrors),
      };
      const page = getPage();
      if (page && !page.isClosed()) {
        report.url = page.url();
        report.diagnostics = await Promise.race([
          diagnose?.(page).catch((cause) => `diagnostics failed: ${cause}`),
          new Promise((done) =>
            setTimeout(done, 5000, "diagnostics timed out"),
          ),
        ]);
        await page
          .screenshot({
            path: `${prefix}.png`,
            fullPage: true,
            timeout: 10_000,
          })
          .catch(() => {});
        await page
          .content()
          .then((html) => writeFile(`${prefix}.html`, html))
          .catch(() => {});
      }
      await writeFile(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
      if (report.pageErrors.length)
        console.log(
          `Page errors during ${name}:\n${report.pageErrors.join("\n")}`,
        );
      if (report.diagnostics)
        console.log(`Diagnostics: ${JSON.stringify(report.diagnostics)}`);
      console.log(`Failure evidence: ${prefix}.{json,png,html}`);
      throw error;
    }
    clearTimeout(timer);
    checks.push({ name, passed: true, seconds: Number(seconds()) });
    console.log(`PASS ${label}: ${name} (${seconds()}s)`);
  }
}
