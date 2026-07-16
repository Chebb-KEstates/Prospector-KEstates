export interface SessionStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

function createSessionStoreWeb(): SessionStore {
  return {
    read(key: string): string | null {
      return sessionStorage.getItem(key);
    },
    write(key: string, value: string): void {
      sessionStorage.setItem(key, value);
    },
    remove(key: string): void {
      sessionStorage.removeItem(key);
    },
  };
}

let instance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!instance) instance = createSessionStoreWeb();
  return instance;
}
