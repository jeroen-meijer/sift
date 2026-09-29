describe("Sift shell (native e2e)", () => {
  it("shows the main window webview", async () => {
    const root = await $("#root");
    await root.waitForExist({ timeout: 30_000 });
    await expect(root).toBeExisting();
  });
});
