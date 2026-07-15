export interface TabSync {
  read(key: string): string | null;
  write(key: string, value: string): void;
  onExternalChange(key: string, handler: (value: string) => void): void;
}

function createTabSyncWeb(): TabSync {
  return {
    read(key: string): string | null {
      return localStorage.getItem(key);
    },
    write(key: string, value: string): void {
      localStorage.setItem(key, value);
    },
    onExternalChange(key: string, handler: (value: string) => void): void {
      window.addEventListener('storage', (event) => {
        if (event.key === key && event.newValue != null) {
          handler(event.newValue);
        }
      });
    },
  };
}

let instance: TabSync | null = null;

export function getTabSync(): TabSync {
  if (!instance) instance = createTabSyncWeb();
  return instance;
}
