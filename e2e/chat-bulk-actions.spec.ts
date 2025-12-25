import { expect, test } from '@playwright/test';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5001';
const apiBase = process.env.E2E_API_URL ?? 'http://localhost:5010';

const skipIfUnreachable = async (page: any) => {
  try {
    const ping = await page.request.get(baseUrl);
    if (!ping.ok()) {
      test.skip(`Client not reachable (${ping.status()})`);
    }
  } catch {
    test.skip('Client not reachable (request failed)');
  }
};

function installProviderMocks(page: any) {
  return Promise.all([
    page.route('**/chat/providers*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            {
              id: 'lmstudio',
              label: 'LM Studio',
              available: true,
              toolsAvailable: true,
            },
          ],
        }),
      }),
    ),
    page.route('**/chat/models*', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'lmstudio',
          available: true,
          toolsAvailable: true,
          models: [{ key: 'mock-model', displayName: 'Mock Model' }],
        }),
      }),
    ),
  ]);
}

async function createConversation(request: any, title: string) {
  const res = await request.post(`${apiBase}/conversations`, {
    data: {
      provider: 'lmstudio',
      model: 'mock-model',
      title,
      source: 'REST',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.conversationId as string;
}

async function bulkArchive(request: any, ids: string[]) {
  const res = await request.post(`${apiBase}/conversations/bulk/archive`, {
    data: { conversationIds: ids },
  });
  expect(res.ok()).toBeTruthy();
}

async function selectByTitle(page: any, title: string) {
  const rowTitle = page
    .getByTestId('conversation-title')
    .filter({ hasText: title })
    .first();
  await expect(rowTitle).toBeVisible({ timeout: 20000 });
  const row = rowTitle.locator('xpath=ancestor-or-self::*[@data-testid="conversation-row"]');
  await row.getByTestId('conversation-select').click();
}

test('bulk archive hides items from Active list immediately', async ({ page }) => {
  await skipIfUnreachable(page);
  await installProviderMocks(page);

  const titleA = `e2e-archive-a-${Date.now()}`;
  const titleB = `e2e-archive-b-${Date.now()}`;
  const titleC = `e2e-archive-c-${Date.now()}`;
  await createConversation(page.request, titleA);
  await createConversation(page.request, titleB);
  await createConversation(page.request, titleC);

  await page.goto(`${baseUrl}/chat`);

  await selectByTitle(page, titleA);
  await selectByTitle(page, titleB);

  await page.getByTestId('conversation-bulk-archive').click();
  await expect(page.getByText('Archived 2 conversation(s).')).toBeVisible({
    timeout: 20000,
  });

  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleA }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleB }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleC }),
  ).toBeVisible();
});

test('bulk restore works from Archived view', async ({ page }) => {
  await skipIfUnreachable(page);
  await installProviderMocks(page);

  const titleA = `e2e-restore-a-${Date.now()}`;
  const titleB = `e2e-restore-b-${Date.now()}`;
  const idA = await createConversation(page.request, titleA);
  const idB = await createConversation(page.request, titleB);
  await bulkArchive(page.request, [idA, idB]);

  await page.goto(`${baseUrl}/chat`);

  const archivedButton = page.getByRole('button', { name: 'Archived', exact: true });
  await expect(archivedButton).toBeEnabled({ timeout: 20000 });
  await archivedButton.click();

  await selectByTitle(page, titleA);
  await selectByTitle(page, titleB);

  await page.getByTestId('conversation-bulk-restore').click();
  await expect(page.getByText('Restored 2 conversation(s).')).toBeVisible({
    timeout: 20000,
  });

  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleA }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleB }),
  ).toHaveCount(0);

  const activeButton = page.getByRole('button', { name: 'Active', exact: true });
  await expect(activeButton).toBeEnabled({ timeout: 20000 });
  await activeButton.click();
  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleA }),
  ).toBeVisible();
  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleB }),
  ).toBeVisible();
});

test('bulk delete requires confirmation and removes items', async ({ page }) => {
  await skipIfUnreachable(page);
  await installProviderMocks(page);

  const titleA = `e2e-delete-a-${Date.now()}`;
  const titleB = `e2e-delete-b-${Date.now()}`;
  const idA = await createConversation(page.request, titleA);
  const idB = await createConversation(page.request, titleB);
  await bulkArchive(page.request, [idA, idB]);

  await page.goto(`${baseUrl}/chat`);
  const archivedButton = page.getByRole('button', { name: 'Archived', exact: true });
  await expect(archivedButton).toBeEnabled({ timeout: 20000 });
  await archivedButton.click();

  await selectByTitle(page, titleA);
  await selectByTitle(page, titleB);

  await page.getByTestId('conversation-bulk-delete').click();
  const dialog = page.getByTestId('conversation-delete-dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await page.getByTestId('conversation-bulk-delete').click();
  await expect(dialog).toBeVisible();

  await dialog.getByTestId('conversation-delete-confirm').click();
  await expect(page.getByText('Deleted 2 conversation(s).')).toBeVisible({
    timeout: 20000,
  });

  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleA }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('conversation-title').filter({ hasText: titleB }),
  ).toHaveCount(0);
});
