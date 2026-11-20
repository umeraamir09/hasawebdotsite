// Adds a link through the links control. The control moves focus to the new
// link's first field on the next animation frame; on a slow runner that frame
// can land while the test is already filling another field, so wait for it.
export async function addLink(scope) {
  const page = typeof scope.page === "function" ? scope.page() : scope;
  await scope.getByRole("button", { name: "Add link", exact: true }).click();
  await page.waitForFunction(() =>
    document.activeElement?.matches("[data-link-id] input"),
  );
}
