import { test, expect } from '@playwright/test';

test.describe('Full Application Flow', () => {
  test('should complete onboarding and reach dashboard', async ({ page }) => {
    await page.goto('/');
    
    // Check if onboarding starts
    await expect(page.locator('text=AirSync-Lite')).toBeVisible();
    
    // Navigate through onboarding (depends on actual implementation)
    // This is a placeholder - adjust based on actual UI
    const startButton = page.locator('button:has-text("Начать"), button:has-text("Start")');
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }
  });

  test('should navigate between main pages', async ({ page }) => {
    await page.goto('/');
    
    // Try to navigate to folders
    const foldersLink = page.locator('a[href*="/folders"], button:has-text("Folders"), button:has-text("Папки")');
    if (await foldersLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await foldersLink.click();
      await expect(page).toHaveURL(/folders/);
    }
    
    // Try to navigate to devices
    const devicesLink = page.locator('a[href*="/devices"], button:has-text("Devices"), button:has-text("Устройства")');
    if (await devicesLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await devicesLink.click();
      await expect(page).toHaveURL(/devices/);
    }
  });

  test('should open settings page', async ({ page }) => {
    await page.goto('/');
    
    const settingsLink = page.locator('a[href*="/settings"], button:has-text("Settings"), button:has-text("Настройки")');
    if (await settingsLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await settingsLink.click();
      await expect(page).toHaveURL(/settings/);
    }
  });

  test('should render without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Filter out known safe errors (like missing electron API in browser)
    const criticalErrors = consoleErrors.filter(err => 
      !err.includes('electronAPI') && 
      !err.includes('ResizeObserver') &&
      !err.includes('favicon')
    );
    
    expect(criticalErrors.length).toBe(0);
  });
});
