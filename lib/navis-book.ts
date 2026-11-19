import puppeteer, { type Page } from "puppeteer-core";
import { filterSlots, pickSlot, type Priority, type Range, type Slot } from "@/lib/booking";
import { parseOpening } from "@/lib/openings";

export type NavisBookRequest = {
  gate: string;
  transaction: string;
  container: string;
  appointmentDate: string;
  ranges: Range[];
  priority: Priority;
  lineOperator: string;
  truckingCompany: string;
  truckLicense: string;
  driverCard: string;
  reference: string;
  save: boolean;
};

export type NavisBookStatus =
  | "secured"
  | "duplicate"
  | "quota"
  | "no-openings"
  | "out-of-range"
  | "equipment"
  | "error";

export type NavisBookResult = {
  status: NavisBookStatus;
  retry: boolean;
  log: string[];
  openings: Slot[];
  selected: Slot | null;
  quotaCount: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function bookOnNavis(request: NavisBookRequest): Promise<NavisBookResult> {
  const url = process.env.NAVIS_URL;
  const username = process.env.NAVIS_USERNAME;
  const password = process.env.NAVIS_PASSWORD;
  if (!url || !username || !password) {
    return fail("Navis sign-in is not configured on the server.", false);
  }

  const log: string[] = [];
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await signIn(page, url, username, password);
    log.push("Signed in to Navis.");
    await openAddAppointment(page);
    log.push("Opened Add Appointment.");
    await typeCombo(page, "Gate/Zone:", 0, request.gate, "Enter");
    log.push(`Gate set to ${request.gate}.`);
    await typeCombo(page, "Transaction Type:", 1, request.transaction, "Tab");
    await page.waitForFunction(
      () => [...document.querySelectorAll(".z-label")].some((el) => (el.textContent || "").includes("Container Id")),
      { timeout: 8000 },
    );
    log.push(`Transaction set to ${request.transaction}.`);
    await typeCombo(page, "Container Id:", 0, request.container.trim().toUpperCase(), "Tab");
    await delay(1200);
    const equipment = await popupText(page, "Action");
    if (equipment) {
      await closePopup(page, "Action");
      log.push(equipment);
      return done("equipment", false, log);
    }
    const containerValue = await fieldValue(page, "Container Id:", 0);
    if (containerValue.toUpperCase() !== request.container.trim().toUpperCase()) {
      log.push("Navis did not keep the container number.");
      return done("error", false, log);
    }
    log.push(`Container ${containerValue}.`);
    await selectOptional(page, "Line Operator:", 0, request.lineOperator);
    await selectOptional(page, "Trucking Company:", 1, request.truckingCompany);
    await fillOptional(page, "Truck License Nbr:", 0, request.truckLicense, "Tab");
    await fillOptional(page, "Driver Card Id:", 1, request.driverCard, "Tab");
    await fillOptional(page, "Reference Nbr:", 0, request.reference, "Tab");

    const refreshUntil = Date.now() + 22_000;
    let sawDialog = await commitDate(page, request.appointmentDate);
    while (sawDialog && Date.now() < refreshUntil) {
      log.push("No Appointment Openings Available. Closed the dialog and refreshed the date.");
      await dismissOpeningsDialog(page);
      sawDialog = await clearAndCommitDate(page, request.appointmentDate);
    }
    if (sawDialog) {
      await dismissOpeningsDialog(page);
      log.push("Still no openings. Closed the dialog. The run will refresh again.");
      await cancelForm(page);
      return done("no-openings", true, log);
    }

    const rawOpenings = await readOpenings(page);
    const openings = rawOpenings
      .map((line) => parseOpening(line, request.appointmentDate))
      .filter((slot): slot is Slot => slot !== null);
    log.push(
      rawOpenings.length
        ? `Openings: ${rawOpenings.slice(0, 8).join(" \u00b7 ")}`
        : "The openings list was empty.",
    );
    if (openings.length === 0) {
      await cancelForm(page);
      return done("no-openings", true, log, openings);
    }

    const skipped: string[] = [];
    let quotaCount = 0;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const choice = pickSlot(filterSlots(openings, request.ranges, skipped), request.priority);
      if (!choice) {
        log.push("None of the openings sit inside the requested ranges.");
        await cancelForm(page);
        return done("out-of-range", true, log, openings, null, quotaCount);
      }
      await chooseOpening(page, choice.id);
      log.push(`Selected ${choice.start}-${choice.end}.`);
      if (!request.save) {
        await cancelForm(page);
        log.push("Save was not pressed.");
        return done("error", false, log, openings, choice, quotaCount);
      }
      await clickNamed(page, "Save");
      const outcome = await readSaveOutcome(page);
      log.push(outcome.detail);
      if (outcome.status === "quota") {
        quotaCount += 1;
        skipped.push(choice.id);
        log.push("Quota reached for that interval. The run moves to the next match.");
        continue;
      }
      if (outcome.status === "secured") {
        return done("secured", false, log, openings, choice, quotaCount);
      }
      return done(outcome.status, false, log, openings, choice, quotaCount);
    }
    await cancelForm(page);
    log.push("Every matching interval reported that the quota is reached.");
    return done("quota", true, log, openings, null, quotaCount);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Navis could not be driven.";
    log.push(message.replace(/Maison\S*/gi, "[redacted]"));
    return done("error", true, log);
  } finally {
    await browser?.close();
  }
}

function done(
  status: NavisBookStatus,
  retry: boolean,
  log: string[],
  openings: Slot[] = [],
  selected: Slot | null = null,
  quotaCount = 0,
): NavisBookResult {
  return { status, retry, log, openings, selected, quotaCount };
}

function fail(message: string, retry: boolean): NavisBookResult {
  return done("error", retry, [message]);
}

async function launchBrowser() {
  const local = process.env.CHROME_PATH;
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      defaultViewport: { width: 1680, height: 1100 },
    });
  }
  const chromium = (await import("@sparticuz/chromium")).default as {
    args: string[];
    executablePath: () => Promise<string>;
    setGraphicsMode: boolean;
  };
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: { width: 1680, height: 1100 },
  });
}

async function signIn(page: Page, url: string, username: string, password: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("input[type=password]", { timeout: 20000 });
  await page.click("input[type=text]");
  await page.keyboard.type(username, { delay: 4 });
  await page.click("input[type=password]");
  await page.keyboard.type(password, { delay: 4 });
  await page.keyboard.press("Enter");
  try {
    await page.waitForFunction(
      () => (document.body?.textContent || "").includes("Gate") && location.href.includes("apexHomeView"),
      { timeout: 25000 },
    );
  } catch {
    throw new Error("Navis did not open the desk. The sign-in was not accepted.");
  }
}

async function openAddAppointment(page: Page) {
  for (const item of await page.$$(".app-nav li.z-menu")) {
    const label = await item.evaluate((el) => (el.textContent || "").replace(/\s+/g, " ").trim().split(" ")[0]);
    if (label === "Gate") {
      await item.click();
      break;
    }
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".z-menuitem-text")].some((el) => (el.textContent || "").trim() === "Appointments"),
  );
  const menuClicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".z-menuitem-text")].find(
      (node) => (node.textContent || "").trim() === "Appointments",
    );
    (item as HTMLElement | undefined)?.click();
    return Boolean(item);
  });
  if (!menuClicked) throw new Error("The Appointments menu item was not found.");
  await page.waitForSelector(".add-button-section");
  await page.click(".add-button-section");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".z-window-header")].some((el) => (el.textContent || "").includes("Add Appointment")),
  );
  await delay(400);
}

async function typeCombo(page: Page, label: string, index: number, value: string, key: "Enter" | "Tab") {
  await clickField(page, label, index);
  await page.keyboard.type(value, { delay: 5 });
  await page.keyboard.press(key);
  await delay(key === "Tab" ? 700 : 400);
}

async function selectOptional(page: Page, label: string, index: number, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const opened = await page.evaluate(
    (wanted, fieldIndex) => {
      const header = [...document.querySelectorAll(".z-window-header")].find((el) =>
        (el.textContent || "").includes("Add Appointment"),
      );
      const found = [...(header?.closest(".z-window")?.querySelectorAll(".z-label") || [])].find(
        (el) => (el.textContent || "").replace(/\s+/g, " ").trim() === wanted,
      );
      const input = [...(found?.closest("tr")?.querySelectorAll("input") || [])][fieldIndex];
      const button = input?.closest(".z-combobox")?.querySelector(".z-combobox-button");
      if (!button) return false;
      (button as HTMLElement).click();
      return true;
    },
    label,
    index,
  );
  if (!opened) return;
  await delay(700);
  const picked = await page.evaluate((wanted) => {
    const item = [...document.querySelectorAll(".z-comboitem-text")].find(
      (el) => (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase() === wanted.toUpperCase(),
    );
    (item as HTMLElement | undefined)?.click();
    return (item?.textContent || "").replace(/\s+/g, " ").trim();
  }, trimmed);
  if (!picked) await page.keyboard.press("Escape");
  await delay(300);
}

async function fillOptional(page: Page, label: string, index: number, value: string, key: "Enter" | "Tab") {
  const trimmed = value.trim();
  if (!trimmed) return;
  const present = await page.evaluate((wanted) => {
    const header = [...document.querySelectorAll(".z-window-header")].find((el) =>
      (el.textContent || "").includes("Add Appointment"),
    );
    return [...(header?.closest(".z-window")?.querySelectorAll(".z-label") || [])].some(
      (el) => (el.textContent || "").replace(/\s+/g, " ").trim() === wanted,
    );
  }, label);
  if (!present) return;
  await typeCombo(page, label, index, trimmed, key);
}

async function clickField(page: Page, label: string, index: number) {
  const box = await page.evaluate(
    (wanted, fieldIndex) => {
      const header = [...document.querySelectorAll(".z-window-header")].find((el) =>
        (el.textContent || "").includes("Add Appointment"),
      );
      const found = [...(header?.closest(".z-window")?.querySelectorAll(".z-label") || [])].find(
        (el) => (el.textContent || "").replace(/\s+/g, " ").trim() === wanted,
      );
      const input = [...(found?.closest("tr")?.querySelectorAll("input") || [])][fieldIndex];
      const rect = input?.getBoundingClientRect();
      if (!rect || rect.width < 2) return null;
      return { x: rect.x + 10, y: rect.y + rect.height / 2 };
    },
    label,
    index,
  );
  if (!box) throw new Error(`The ${label.replace(/:$/, "")} field is not on the form.`);
  await page.mouse.click(box.x, box.y);
  await delay(150);
}

async function fieldValue(page: Page, label: string, index: number) {
  return page.evaluate(
    (wanted, fieldIndex) => {
      const header = [...document.querySelectorAll(".z-window-header")].find((el) =>
        (el.textContent || "").includes("Add Appointment"),
      );
      const found = [...(header?.closest(".z-window")?.querySelectorAll(".z-label") || [])].find(
        (el) => (el.textContent || "").replace(/\s+/g, " ").trim() === wanted,
      );
      return ([...(found?.closest("tr")?.querySelectorAll("input") || [])][fieldIndex] as HTMLInputElement | undefined)
        ?.value || "";
    },
    label,
    index,
  );
}

async function commitDate(page: Page, iso: string) {
  await clickField(page, "Requested Date:", 0);
  await page.keyboard.type(iso, { delay: 6 });
  await page.keyboard.press("Tab");
  await delay(1600);
  return (await popupText(page, "No Appointment")) !== null;
}

async function clearAndCommitDate(page: Page, iso: string) {
  await clickField(page, "Requested Date:", 0);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(iso, { delay: 6 });
  await page.keyboard.press("Tab");
  await delay(1600);
  return (await popupText(page, "No Appointment")) !== null;
}

async function popupText(page: Page, titlePart: string) {
  return page.evaluate((part) => {
    const header = [...document.querySelectorAll(".z-window-header")].find((el) => (el.textContent || "").includes(part));
    if (!header) return null;
    return (header.closest(".z-window")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);
  }, titlePart);
}

async function dismissOpeningsDialog(page: Page) {
  await closePopup(page, "No Appointment");
  await delay(400);
}

async function closePopup(page: Page, titlePart: string) {
  await page.evaluate((part) => {
    const header = [...document.querySelectorAll(".z-window-header")].find((el) => (el.textContent || "").includes(part));
    const win = header?.closest(".z-window");
    if (!win) return;
    const button = [...win.querySelectorAll("button")].find((el) => !/save/i.test(el.textContent || ""));
    if (button) {
      (button as HTMLElement).click();
      return;
    }
    (win.querySelector(".z-window-close") as HTMLElement | null)?.click();
  }, titlePart);
}

async function readOpenings(page: Page) {
  await page.evaluate(() => {
    const header = [...document.querySelectorAll(".z-window-header")].find((el) =>
      (el.textContent || "").includes("Add Appointment"),
    );
    const found = [...(header?.closest(".z-window")?.querySelectorAll(".z-label") || [])].find((el) =>
      (el.textContent || "").includes("Appointment Openings"),
    );
    const input = [...(found?.closest("tr")?.querySelectorAll("input") || [])][1];
    (input?.closest(".z-combobox")?.querySelector(".z-combobox-button") as HTMLElement | null)?.click();
  });
  await delay(1000);
  return page.evaluate(() =>
    [...document.querySelectorAll(".z-comboitem")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

async function chooseOpening(page: Page, label: string) {
  const picked = await page.evaluate((wanted) => {
    const item = [...document.querySelectorAll(".z-comboitem")].find(
      (el) => (el.textContent || "").replace(/\s+/g, " ").trim() === wanted,
    );
    (item as HTMLElement | undefined)?.click();
    return Boolean(item);
  }, label);
  if (!picked) throw new Error("The chosen opening was no longer in the list.");
  await delay(500);
}

async function clickNamed(page: Page, name: "Save" | "Cancel") {
  const box = await page.evaluate((wanted) => {
    const header = [...document.querySelectorAll(".z-window-header")].find((el) =>
      (el.textContent || "").includes("Add Appointment"),
    );
    const button = [...(header?.closest(".z-window")?.querySelectorAll("button") || [])].find(
      (el) => (el.textContent || "").trim() === wanted,
    );
    const rect = button?.getBoundingClientRect();
    if (!rect || rect.width < 2) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, name);
  if (!box) throw new Error(`The ${name} button was not on the Add Appointment window.`);
  await page.mouse.click(box.x, box.y);
}

async function cancelForm(page: Page) {
  try {
    await clickNamed(page, "Cancel");
  } catch {
    await page.keyboard.press("Escape");
  }
}

async function readSaveOutcome(page: Page): Promise<{ status: "secured" | "quota" | "duplicate" | "error"; detail: string }> {
  await delay(2500);
  const text = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".z-window, .z-messagebox")]
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter((value) => value && !value.includes("Clusternode") && value.length < 600);
    const addOpen = [...document.querySelectorAll(".z-window-header")].some((el) =>
      (el.textContent || "").includes("Add Appointment"),
    );
    return { boxes: boxes.slice(0, 6), addOpen };
  });
  const blob = text.boxes.join(" ");
  if (/duplicate/i.test(blob)) return { status: "duplicate", detail: blob.slice(0, 280) };
  if (/quota/i.test(blob)) return { status: "quota", detail: blob.slice(0, 280) };
  if (/error|invalid|required|cannot|failed/i.test(blob)) return { status: "error", detail: blob.slice(0, 280) };
  if (!text.addOpen) return { status: "secured", detail: "Navis closed Add Appointment after Save." };
  return { status: "error", detail: blob.slice(0, 280) || "Navis left Add Appointment open after Save." };
}
