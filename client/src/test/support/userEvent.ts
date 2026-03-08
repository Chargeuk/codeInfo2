import userEvent, { type UserEvent } from '@testing-library/user-event';

export type TestUserEvent = UserEvent;

export function createTestUser(): UserEvent {
  return userEvent.setup();
}
