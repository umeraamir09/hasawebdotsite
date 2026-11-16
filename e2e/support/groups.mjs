import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Selects, times and diagnoses named browser check groups.
//
// --browser-filter=<regexp> runs matching groups. --browser-shard=<k>/<n>
// runs every n-th selected group starting at k, so CI can split one suite
// across runners. Each group has a time limit: a stuck wait fails with the
// group's name and diagnostics instead of running until the job times out.
export function browserSelection(argv = process.argv) {
  const value = (flag) =>
    argv
      .find((argument) => argument.startsWith(`${flag}=`))
      ?.slice(flag.length + 1);
  const filter = value("--browser-filter");
  const shard = value("--browser-shard");
  let index = 0;
  let total = 1;
  if (shard) {
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    if (!match || +match[1] < 1 || +match[1] > +match[2])
      throw new Error(`--browser-shard must be k/n with 1 <= k <= n: ${shard}`);
    index = +match[1] - 1;
    total = +match[2];
  }
  let position = 0;
  return {
    shard: shard ?? null,
    includes(name) {
      if (filter && !new RegExp(filter).test(name)) return false;
      return position++ % total === index;
    },
  };
}

export function createGroupRunner({
  label,
  evidence,
  checks,
  getPage,
  errors = [],
  diagnose,
  limitMs = Number(process.env.BROWSER_GROUP_LIMIT_MS ?? 120_000),
  argv = process.argv,
}) {
  const selection = browserSelection(argv);
  let failures = 0;
  return async function run(name, work) {
    if (!selection.includes(name)) return;
    const started = performance.now();
    const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
    const knownErrors = errors.length;
    let timer;
    try {
      await Promise.race([
        work(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${label} group exceeded ${limitMs / 1000}s: ${name}`,
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
  };
}
