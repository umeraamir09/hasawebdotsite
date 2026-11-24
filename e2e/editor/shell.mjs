// Controls of the editor shell (Phase 51.2): the top bar's Publish panel, the
// rail's Build, Style and Share panels, the page outline and Add section.
// On a phone or tablet width the panels open as a bottom sheet.

const compact = (page) =>
  page
    .locator("main.owner-editor")
    .evaluate((main) => main.dataset.layout === "compact");

// Resizes the page and waits for the shell to switch layout: below 1024 px
// React swaps the rail and panel for the dock and sheets after the resize.
export async function resize(page, size) {
  await page.setViewportSize(size);
  await page.waitForFunction(
    (layout) =>
      document.querySelector("main.owner-editor")?.dataset.layout === layout,
    size.width < 1024 ? "compact" : "wide",
  );
}

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

// The Build panel's page outline. An open section editor returns to it with
// its back button; on a phone the Build button opens it.
export async function outline(page) {
  const region = page.getByRole("region", { name: "Page", exact: true });
  if (await region.isVisible()) return region;
  const back = page.getByRole("button", { name: "Back to page", exact: true });
  if (await back.isVisible()) await back.click();
  else await openPanel(page, "Build");
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
export async function outlineOrder(page) {
  await outline(page);
  return page
    .locator(".page-outline-sections [data-order-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.orderId));
}

// Opens an editor image's options (Phase 51.3): replace, crop, description
// and remove sit behind the image's camera button. `label` is the image's
// name, such as "Avatar" or "Face Reveal photo". Returns the image region.
export async function imageOptions(page, label) {
  const region = page.getByRole("region", {
    name: `${label} image`,
    exact: true,
  });
  const camera = region.getByRole("button", {
    name: `Edit ${label === "Avatar" || label === "Banner" ? label.toLowerCase() : label}`,
    exact: true,
  });
  if ((await camera.getAttribute("aria-expanded")) !== "true")
    await camera.click();
  await region.getByRole("dialog", { name: label, exact: true }).waitFor();
  return region;
}

// The profile editor's decoration gallery. Choosing a tile saves it at once;
// Escape closes the gallery.
export async function decorationGallery(page) {
  await page
    .getByRole("region", { name: "Profile controls", exact: true })
    .getByRole("button", { name: /^Decoration\b/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Decoration", exact: true });
  await dialog.waitFor();
  return dialog;
}

export async function chooseDecoration(page, name) {
  const dialog = await decorationGallery(page);
  await dialog.getByRole("radio", { name, exact: true }).check();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
}

export async function setFaceReveal(page, on) {
  const toggle = page.getByRole("switch", { name: "Face Reveal", exact: true });
  if (((await toggle.getAttribute("aria-checked")) === "true") !== on)
    await toggle.click();
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-publication-field="faceReveal"] [role="switch"]')
        ?.getAttribute("aria-checked") === String(expected),
    on,
  );
}
