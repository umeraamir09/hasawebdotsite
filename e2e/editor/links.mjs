// Setup guide helpers for the Setup v2 Links and Skills steps.

// Adds a link by typing its address into the Links step's large field and
// pressing Enter, then waits for its row. A label replaces the default one
// (the platform name, Email or Website) through the row's popover.
export async function addLink(scope, address, label) {
  const field = scope.getByLabel("Add a link", { exact: true });
  await field.fill(address);
  await field.press("Enter");
  const row = scope
    .locator("[data-link-id]")
    .filter({ hasText: address.replace(/^https?:\/\//, "").replace(/\/$/, "") })
    .first();
  await row.waitFor();
  // Address edits change the row's text, so later steps find it by id.
  const stable = scope.locator(
    `[data-link-id="${await row.getAttribute("data-link-id")}"]`,
  );
  if (label !== undefined) await editLink(scope, stable, { label });
  return stable;
}

// Opens a link row's popover, fills the given fields and closes it.
export async function editLink(scope, row, { label, value }) {
  await row.locator(".guide-link-open").click();
  const popover = scope.locator(".wb-popover");
  if (label !== undefined)
    await popover.getByLabel("Link label", { exact: true }).fill(label);
  if (value !== undefined)
    await popover.getByLabel(/^(Web|Email) address$/).fill(value);
  await popover.getByLabel("Link label", { exact: true }).press("Escape");
}

// Adds one skill through the Skills step's token input.
export async function addSkill(scope, name) {
  const field = scope.getByRole("combobox", { name: "Add a skill" });
  await field.fill(name);
  await field.press("Escape");
  await field.press("Enter");
  await scope
    .locator("[data-skill-id] .guide-token-name")
    .filter({ hasText: name })
    .first()
    .waitFor();
}
