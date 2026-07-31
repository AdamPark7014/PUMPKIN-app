import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import { environment, seedUsers, uniqueTestId } from './environment';
import { bearer, login, type AuthSession } from './api';

type TicketOsFixtures = {
  testId: string;
  adminSession: AuthSession;
  cashierSession: AuthSession;
  scannerSession: AuthSession;
  adminHeaders: Record<string, string>;
};

export const test = base.extend<TicketOsFixtures>({
  testId: async ({}, use, testInfo) => {
    await use(uniqueTestId(testInfo.project.name, testInfo.workerIndex));
  },
  adminSession: async ({}, use) => {
    const context = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      await use(await login(context, seedUsers.superAdmin));
    } finally {
      await context.dispose();
    }
  },
  cashierSession: async ({}, use) => {
    const context = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      await use(await login(context, seedUsers.cashier));
    } finally {
      await context.dispose();
    }
  },
  scannerSession: async ({}, use) => {
    const context = await playwrightRequest.newContext({ baseURL: environment.apiUrl });
    try {
      await use(await login(context, seedUsers.scanner));
    } finally {
      await context.dispose();
    }
  },
  adminHeaders: async ({ adminSession }, use) => {
    await use(bearer(adminSession));
  },
});

export { expect };
