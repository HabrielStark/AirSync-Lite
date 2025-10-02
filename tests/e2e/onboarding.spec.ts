import { test, expect } from '@playwright/test';

test('Onboarding flow', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('text=Начать');
  await page.fill('input[name="folder"]', '/tmp/projects');
  await page.click('text=Продолжить');
  await expect(page.getByText('Подключить устройство')).toBeVisible();
});
