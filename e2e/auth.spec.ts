import { test, expect } from '@playwright/test';

/**
 * E2E Tests: Authentication Flow
 * Tests student registration, login, and profile setup
 */

test.describe('Authentication', () => {
  test('should load the landing page', async ({ page }) => {
    await page.goto('/');

    // Should show login screen
    await expect(page.locator('text=Sabha Ride Seva')).toBeVisible();
  });

  test('should handle login flow', async ({ page }) => {
    await page.goto('/');

    // Wait for login form
    await expect(page.locator('input[type="email"]')).toBeVisible();

    // Enter credentials
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'password123');

    // Submit (note: will fail without actual Firebase connection)
    await page.click('button[type="submit"]');
  });

  // TODO: Add more auth tests after Firebase emulator setup
  // - Student registration
  // - Role selection
  // - Profile setup
  // - Logout
});
