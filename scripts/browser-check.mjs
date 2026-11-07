#!/usr/bin/env node
// Drives the local preview in system Chrome. Uses the synthetic fixture only.
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.PREVIEW_URL || "http://127.0.0.1:41773";
const user = process.env.TRACKER_USER || "preview";
const pass = process.env.TRACKER_PASSWORD || "preview-fixture";
const outDir = path.resolve("artifacts");
const mirror = "/opt/cursor/artifacts";
const chrome = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

async function shot(page, name) {
  await mkdir(outDir, { recursive: true });
  await mkdir(mirror, { recursive: true });
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  await copyFile(file, path.join(mirror, name));
  console.log("screenshot", file);
}

async function open(browser, { width, height, userAgent }) {
  const context = await browser.newContext({
    viewport: { width, height },
    userAgent,
    httpCredentials: { username: user, password: pass },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return { page, errors, context };
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

const desktop = await open(browser, { width: 1280, height: 900 });
await desktop.page.goto(base + "/", { waitUntil: "load" });
await desktop.page.waitForSelector("#tabs .tab");
const tabText = await desktop.page.locator("#tabs").innerText();
if (!/All\s*6/.test(tabText) || !/New jobs\s*6/.test(tabText) || !/Applied\s*2/.test(tabText)) fail("unexpected tab totals: " + JSON.stringify(tabText));
if (/Job interests\s*\d/.test(tabText)) fail("interests tab showed a count before anything was saved");
if (await desktop.page.locator("#installBtn").count()) fail("install button rendered without beforeinstallprompt");
const installText = await desktop.page.locator("#installMsg").innerText();
if (!/no APK/i.test(installText) || !/App Store/i.test(installText)) fail("missing honest install copy");
if (!/username and password/i.test(installText)) fail("missing basic-auth limitation");
if (!(await desktop.page.locator("text=Example North Office Ltd").count())) fail("fixture job missing");
if (!(await desktop.page.locator("text=Bakery supervisor").count())) fail("historical excluded-title row was hidden");
if (!(await desktop.page.locator("#cnt").innerText()).startsWith("6 of 6")) fail("default list count changed");
await shot(desktop.page, "desktop-all-jobs.png");

await desktop.page.locator("#onlyInterests").check();
const limitedBeforeSave = await desktop.page.locator("#cnt").innerText();
if (!limitedBeforeSave.startsWith("6 of 6") || !/not saved yet/i.test(limitedBeforeSave)) fail("optional limit hid jobs before interests were saved: " + limitedBeforeSave);
await desktop.page.locator("#onlyInterests").uncheck();

await desktop.page.getByRole("tab", { name: /Job interests/ }).click();
await desktop.page.waitForSelector("#interest-13100");
if (await desktop.page.locator("#interestRoot input:checked").count()) fail("a role was preselected");
await desktop.page.locator("label[for=interest-13100]").click();
await desktop.page.locator("label[for=interest-22221]").click();
const unsaved = await desktop.page.locator("#interestCount").innerText();
if (!/2 of 8 selected/.test(unsaved) || !/unsaved/i.test(unsaved)) fail("selection count did not show unsaved edits: " + unsaved);
await desktop.page.locator("#interest-13100").scrollIntoViewIfNeeded();
await shot(desktop.page, "desktop-interests-unsaved.png");
await desktop.page.locator("#saveInterests").click();
await desktop.page.waitForFunction(() => /Saved 2 of 8/.test(document.querySelector("#saveStatus")?.textContent || ""));
await desktop.page.locator("#interest-22221").scrollIntoViewIfNeeded();
await shot(desktop.page, "desktop-interests-saved.png");

await desktop.page.reload({ waitUntil: "load" });
await desktop.page.getByRole("tab", { name: /Job interests/ }).click();
await desktop.page.waitForSelector("#interest-13100");
if (!(await desktop.page.locator("#interest-13100").isChecked())) fail("13100 did not survive reload");
if (!(await desktop.page.locator("#interest-22221").isChecked())) fail("22221 did not survive reload");
if (await desktop.page.locator("#interest-75101").isChecked()) fail("an unsaved role was stored");
const savedTab = await desktop.page.locator("#tabs").innerText();
if (!/Job interests\s*2/.test(savedTab) || !/All\s*6/.test(savedTab) || !/Applied\s*2/.test(savedTab)) fail("badges after save: " + JSON.stringify(savedTab));

await desktop.page.getByRole("tab", { name: /^All/ }).click();
if (!(await desktop.page.locator("text=Bakery supervisor").count())) fail("saved interests hid a current job");
await desktop.page.locator("#onlyInterests").check();
const limited = await desktop.page.locator("#cnt").innerText();
if (!limited.startsWith("2 of 6")) fail("optional NOC limit did not match codes: " + limited);
if (await desktop.page.locator("text=Bakery supervisor").count()) fail("optional limit kept a different title in the same NOC? wait, bakery is 62010 and was not selected");
await desktop.page.locator("#onlyInterests").uncheck();

await desktop.page.evaluate(() => {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = () => Promise.resolve();
  event.userChoice = Promise.resolve({ outcome: "dismissed" });
  window.dispatchEvent(event);
});
await desktop.page.waitForSelector("#installBtn");
await desktop.page.locator("#installBtn").click();
if (!(await desktop.page.locator("#installBtn").count())) fail("dismissed install removed the button");

await desktop.page.getByRole("tab", { name: /Job interests/ }).click();
await desktop.page.locator("#interest-13100").uncheck();
await desktop.page.locator("#interest-22221").uncheck();
await desktop.page.locator("#saveInterests").click();
await desktop.page.waitForFunction(() => /Saved empty selection/.test(document.querySelector("#saveStatus")?.textContent || ""));
if (await desktop.page.locator("#interestRoot input:checked").count()) fail("empty save left a box checked");

if (desktop.errors.length) fail("desktop page errors:\n" + desktop.errors.join("\n"));

const iphoneUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const mobile = await open(browser, { width: 390, height: 844, userAgent: iphoneUa });
await mobile.page.goto(base + "/", { waitUntil: "load" });
await mobile.page.waitForSelector("#tabs .tab");
const ios = await mobile.page.locator("#installMsg").innerText();
if (!/Add to Home Screen/i.test(ios) || !/not an App Store app/i.test(ios)) fail("iPhone instructions missing: " + ios);
if (await mobile.page.locator("#installBtn").count()) fail("iPhone showed an install button");
await shot(mobile.page, "mobile-all-jobs.png");
await mobile.page.locator("tbody tr.job").first().scrollIntoViewIfNeeded();
await shot(mobile.page, "mobile-job-cards.png");
await mobile.page.getByRole("tab", { name: /Job interests/ }).click();
await mobile.page.waitForSelector("#interest-14400");
await mobile.page.locator("#interest-14400").scrollIntoViewIfNeeded();
await shot(mobile.page, "mobile-job-interests.png");
const labelFor = await mobile.page.locator("label[for=interest-14400]").count();
if (!labelFor) fail("role checkbox has no label");
if (mobile.errors.length) fail("mobile page errors:\n" + mobile.errors.join("\n"));

await browser.close();
console.log("browser checks passed");
