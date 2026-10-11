import { expect, Page, test } from "@playwright/test";

// Każdy test na świeżym koncie — dane per user, więc testy się nie mieszają.
async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: /Zarejestruj się/ }).click();
  await page.getByPlaceholder("E-mail").fill(email);
  await page.getByPlaceholder("Hasło").fill("e2e-password-123");
  await page.getByRole("button", { name: "Zarejestruj", exact: true }).click();
  await expect(page).toHaveURL(/\/tworz$/);
  return email;
}

/** Zakładka po nazwie — górny pasek na desktopie, dolny na mobile. */
async function openTab(page: Page, name: string) {
  const top = page.locator("header nav").getByRole("button", { name: new RegExp(`^${name}`) });
  if (await top.isVisible()) await top.click();
  else
    await page
      .locator(".bottom-nav")
      .getByRole("button", { name: new RegExp(name) })
      .click();
}

test("sign up, navigate tabs and see empty states", async ({ page }) => {
  await signUp(page);
  await openTab(page, "Biblioteka");
  await expect(page).toHaveURL(/\/biblioteka$/);
  await expect(page.getByText("Brak wygenerowanych utworów")).toBeVisible();
  // nieznana ścieżka wraca na „Twórz”, sesja przeżywa przeładowanie
  await page.goto("/nie-ma-takiej");
  await expect(page).toHaveURL(/\/tworz$/);
});

test("settings persist on the account", async ({ page }) => {
  await signUp(page);
  await openTab(page, "Ustawienia");
  await page.getByPlaceholder("Klucz z panelu api.sunoapi.org").fill("suno-e2e-key");
  await page.getByRole("button", { name: "Zapisz ustawienia" }).click();
  await expect(page.getByText("Zapisano")).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("Klucz z panelu api.sunoapi.org")).toHaveValue("suno-e2e-key");
  // sekcja „Ten komputer” istnieje tylko w powłoce desktopowej
  await expect(page.getByRole("heading", { name: "Ten komputer" })).toHaveCount(0);
});

test("library file upload, kind toggle and removal", async ({ page }) => {
  await signUp(page);
  await openTab(page, "Pliki");
  await page.locator('input[type="file"]').setInputFiles({
    name: "poradnik suno.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Tagi\n\n[Verse] [Chorus]\n\nDrugi akapit poradnika."),
  });
  const row = page.locator(".filedrop-list li", { hasText: "poradnik suno.md" });
  const kind = row.getByTitle("Kliknij, aby zmienić rolę pliku");
  // nazwa z „poradnik/suno” → automatycznie rola poradnika; klik przełącza na źródło
  await expect(kind).toHaveText(/poradnik/);
  await kind.click();
  await expect(kind).toHaveText(/źródło/);
  await page.reload();
  await expect(kind).toHaveText(/źródło/);
  await row.getByTitle("Usuń z biblioteki").click();
  await expect(row).toHaveCount(0);
});
