/**
 * Deterministic inspection. No LLM, no paid API, no network beyond the target.
 *
 * Every rule is a measurement, and every measurement is written into the
 * report, so a disagreement can be settled by re-running the same file instead
 * of trusting this process.
 */
const { chromium } = require("playwright");

const HARD_TIMEOUT_MS = 15_000;

async function inspect({ url, rules, screenshotPath }) {
  const started = Date.now();
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 500)));
  page.on("requestfailed", (req) => {
    failedRequests.push({ url: req.url().slice(0, 300), error: req.failure()?.errorText ?? "unknown" });
  });

  let navigation = { status: 0, ms: 0, error: null };
  const work = (async () => {
    const t0 = Date.now();
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: HARD_TIMEOUT_MS - 1000 });
      navigation.status = res ? res.status() : 0;
    } catch (e) {
      navigation.error = e.message.slice(0, 300);
    }
    navigation.ms = Date.now() - t0;
    // Let late console errors land before we read them.
    await page.waitForTimeout(1200);
  })();

  const timedOut = await Promise.race([
    work.then(() => false),
    new Promise((r) => setTimeout(() => r(true), HARD_TIMEOUT_MS)),
  ]);

  const results = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const base = { index: i, type: rule.type };
    try {
      switch (rule.type) {
        case "http_status": {
          const observed = navigation.status;
          results.push({ ...base, expected: rule.expected, observed, passed: observed === rule.expected });
          break;
        }
        case "console_errors": {
          const observed = consoleErrors.length + pageErrors.length;
          results.push({ ...base, max: rule.max, observed, passed: observed <= rule.max, samples: consoleErrors.slice(0, 3) });
          break;
        }
        case "no_cors_error": {
          const hits = consoleErrors.filter((t) => /cors|access-control-allow-origin/i.test(t));
          results.push({ ...base, observed: hits.length, passed: hits.length === 0, samples: hits.slice(0, 3) });
          break;
        }
        case "dom_selector": {
          const loc = page.locator(rule.selector).first();
          const state = rule.state || "visible";
          let observed = "missing";
          let passed = false;
          const count = await page.locator(rule.selector).count();
          if (count > 0) {
            if (state === "attached") {
              observed = "attached";
              passed = true;
            } else if (state === "visible") {
              const vis = await loc.isVisible().catch(() => false);
              observed = vis ? "visible" : "hidden";
              passed = vis;
            } else {
              const vis = await loc.isVisible().catch(() => false);
              observed = vis ? "visible" : "hidden";
              passed = !vis;
            }
          }
          results.push({ ...base, selector: rule.selector, expected: state, observed, passed });
          break;
        }
        case "text_contains": {
          const text = await page.locator("body").innerText().catch(() => "");
          const passed = text.includes(rule.text);
          results.push({ ...base, text: rule.text, observed: passed ? "found" : "not found", passed });
          break;
        }
        case "response_time_ms": {
          const observed = navigation.ms;
          results.push({ ...base, max: rule.max, observed, passed: observed <= rule.max });
          break;
        }
        default:
          results.push({ ...base, passed: false, observed: "unsupported rule type" });
      }
    } catch (e) {
      results.push({ ...base, passed: false, observed: `error: ${String(e.message).slice(0, 200)}` });
    }
  }

  let screenshot = null;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshot = screenshotPath;
  } catch (e) {
    screenshot = `failed: ${String(e.message).slice(0, 120)}`;
  }

  const browserInfo = { name: "chromium", version: browser.version() };
  await browser.close();

  const overall = timedOut ? "fail" : results.every((r) => r.passed) ? "pass" : "fail";
  return {
    overall,
    timed_out: timedOut,
    navigation,
    browser: browserInfo,
    results,
    console_error_count: consoleErrors.length,
    page_error_count: pageErrors.length,
    failed_request_count: failedRequests.length,
    failed_requests: failedRequests.slice(0, 5),
    duration_ms: Date.now() - started,
    screenshot,
  };
}

module.exports = { inspect, HARD_TIMEOUT_MS };
