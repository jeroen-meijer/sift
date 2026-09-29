describe("Sift shell (browser mode)", () => {
  beforeEach(async () => {
    await browser.url("http://localhost:1420/");
    const { mockEmptyLibraryBoot } = await import("../../helpers/mockBoot.ts");
    await mockEmptyLibraryBoot();
    // Second navigation: boot invokes run after mocks are registered for this document.
    await browser.url("http://localhost:1420/");
    await mockEmptyLibraryBoot();
  });

  it("shows first-run after mocked empty library boot", async () => {
    const firstLaunch = await $(".first-launch");
    await firstLaunch.waitForExist({ timeout: 15_000 });
    await expect(firstLaunch).toBeExisting();
  });
});