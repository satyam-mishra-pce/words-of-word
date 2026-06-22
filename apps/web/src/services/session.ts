const USERNAME_KEY = 'wow.username';

export function saveUsername(username: string): void {
  localStorage.setItem(USERNAME_KEY, username.trim());
}

export function loadUsername(): string {
  return localStorage.getItem(USERNAME_KEY) ?? '';
}
