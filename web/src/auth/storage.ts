export type Account = {
  name: string;
  login: string;
  passwordHash: string;
};

export type Session = {
  name: string;
  login: string;
};

const USERS_KEY = "diplom.users";
const SESSION_KEY = "diplom.session";

export async function hashPassword(password: string) {
  const data = new TextEncoder().encode(password);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readUsers(): Account[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Array<Partial<Account> & { email?: string }>) : [];
    return parsed
      .map((user) => ({
        name: user.name ?? "",
        login: (user.login ?? user.email ?? "").toLowerCase(),
        passwordHash: user.passwordHash ?? "",
      }))
      .filter((user) => user.login && user.passwordHash);
  } catch {
    return [];
  }
}

function writeUsers(users: Account[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> & { email?: string };
    const login = (parsed.login ?? parsed.email ?? "").toLowerCase();
    if (!login || !parsed.name) return null;
    return { name: parsed.name, login };
  } catch {
    return null;
  }
}

export function writeSession(session: Session | null) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function registerAccount(name: string, login: string, password: string) {
  const users = readUsers();
  const normalized = login.trim().toLowerCase();
  if (users.some((user) => user.login === normalized)) {
    throw new Error("Аккаунт с таким логином уже есть");
  }
  const account: Account = {
    name: name.trim(),
    login: normalized,
    passwordHash: await hashPassword(password),
  };
  writeUsers([...users, account]);
  const session = { name: account.name, login: account.login };
  writeSession(session);
  return session;
}

export async function loginAccount(login: string, password: string) {
  await ensureDemoAccount();
  const users = readUsers();
  const normalized = login.trim().toLowerCase();
  const account = users.find((user) => user.login === normalized);
  if (!account) throw new Error("Неверный логин или пароль");
  const passwordHash = await hashPassword(password);
  if (account.passwordHash !== passwordHash) throw new Error("Неверный логин или пароль");
  const session = { name: account.name, login: account.login };
  writeSession(session);
  return session;
}

export async function ensureDemoAccount() {
  const users = readUsers();
  const demoLogin = "test";
  const demoHash = await hashPassword("test");
  const existing = users.find((user) => user.login === demoLogin);
  if (existing) {
    if (existing.passwordHash !== demoHash || existing.name !== "Test") {
      writeUsers(
        users.map((user) =>
          user.login === demoLogin
            ? { name: "Test", login: demoLogin, passwordHash: demoHash }
            : user,
        ),
      );
    }
    return;
  }
  writeUsers([...users, { name: "Test", login: demoLogin, passwordHash: demoHash }]);
}
