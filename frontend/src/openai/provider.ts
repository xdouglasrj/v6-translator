import { storage } from "@/src/utils/storage";

const KEY = "openai_api_key";

export async function getApiKey(): Promise<string | null> {
  return storage.secureGet(KEY, "");
}

export async function setApiKey(key: string): Promise<boolean> {
  return storage.secureSet(KEY, key);
}

export async function removeApiKey(): Promise<boolean> {
  return storage.secureRemove(KEY);
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "sk-…";
  return `sk-…${key.slice(-4)}`;
}
