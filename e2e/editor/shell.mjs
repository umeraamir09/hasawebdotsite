// Controls of the editor shell (Phase 51.2): the top bar's Publish panel, the
// rail's Build, Style and Share panels, the page outline and Add section.
// On a phone or tablet width the panels open as a bottom sheet.

const compact = (page) =>
  page
    .locator("main.owner-editor")
    .evaluate((main) => main.dataset.layout === "compact");

// Opens the Publish panel (it stays open until closed) and returns the
// checklist inside it.
export async function openChecklist(page) {
  await closeSheet(page);
  const toggle = page.locator('[aria-controls="editor-publish"]');
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  return page.getByRole("region", { name: "Publication checklist" });
}

// "Build", "Style" or "Share".
export async function openPanel(page, name) {
  const small = await compact(page);
  if (small) await closeSheet(page);
  await page
    .getByRole("navigation", { name: "Editor" })
    .getByRole("button", { name, exact: true })
    .click();
  return page.getByRole("region", { name, exact: true });
}

export async function closeSheet(page) {
  if (!(await compact(page))) return;
  const sheet = page.locator(".editor-panel:not([hidden])");
  if (await sheet.count())
    await sheet
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
}

// The Build panel's page outline. On a phone the Build button opens it.
export async function outline(page) {
  const region = page.getByRole("region", { name: "Page", exact: true });
  if (await region.isVisible()) return region;
  if (await compact(page)) {
    const back = page.getByRole("button", {
      name: "Back to page",
      exact: true,
    });
    if (await back.isVisible()) await back.click();
    else await openPanel(page, "Build");
  } else await openPanel(page, "Build");
  return region;
}

// Opens an outline row (or the profile card) and its editor.
export async function openSection(page, name) {
  const region = await outline(page);
  await region
    .getByRole("button", {
      name: name === "Profile" ? /^Profile\b/ : name,
      exact: name !== "Profile",
    })
    .click();
}

export async function addSection(page, title) {
  const region = await outline(page);
  await region
    .getByRole("button", { name: "Add section", exact: true })
    .last()
    .click();
  await page
    .getByRole("dialog", { name: "Add section" })
    .getByRole("button", { name: `Add ${title}`, exact: true })
    .click();
}

// Asks to remove a section from its outline row (Delete), which opens the
// confirmation.
export async function removeSection(page, name) {
  const region = await outline(page);
  await region.getByRole("button", { name, exact: true }).press("Delete");
}

// The section ids in outline order.
export function outlineOrder(page) {
  return page
    .locator(".page-outline-sections [data-order-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.orderId));
}
