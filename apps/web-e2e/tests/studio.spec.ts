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
  const bottom = page.locator(".bottom-nav").getByRole("button", { name: new RegExp(name) });
  // isVisible() nie czeka — najpierw poczekaj, aż wyrenderuje się którykolwiek pasek
  await expect(top.or(bottom).first()).toBeVisible();
  await ((await top.isVisible()) ? top : bottom).click();
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

test("account: JSON export without keys, then account deletion", async ({ page }) => {
  const email = await signUp(page);
  await openTab(page, "Ustawienia");
  await page.getByPlaceholder("Klucz z panelu api.sunoapi.org").fill("tajny-klucz");
  await page.getByRole("button", { name: "Zapisz ustawienia" }).click();
  await expect(page.getByText("Zapisano", { exact: true })).toBeVisible();

  await expect(page.getByText(/Archiwum audio i okładek/)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Eksport danych/ }).click(),
  ]);
  const exported = await download.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  });
  expect(JSON.parse(exported).format).toBe("suno-studio-export@1");
  expect(exported).not.toContain("tajny-klucz");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByPlaceholder("USUŃ").fill("USUŃ");
  await page.getByRole("button", { name: /Usuń konto/ }).click();
  await expect(page.getByRole("button", { name: "Zaloguj", exact: true })).toBeVisible();

  // konto naprawdę zniknęło — logowanie tym samym e-mailem się nie udaje
  await page.getByPlaceholder("E-mail").fill(email);
  await page.getByPlaceholder("Hasło").fill("e2e-password-123");
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();
  await expect(page.locator(".signin .error")).toBeVisible();
});

test("password reset link is hidden without a configured mail provider", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Zaloguj", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Nie pamiętasz hasła/ })).toHaveCount(0);
});
