import { CardStore } from "../lib/store.js";

interface ReadResult {
  success: boolean;
  content?: string;
  error?: string;
}

export async function readCommand(store: CardStore, slug: string): Promise<ReadResult> {
  try {
    const content = await store.readCard(slug);
    return { success: true, content };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
