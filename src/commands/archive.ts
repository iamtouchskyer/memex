import { CardStore } from "../lib/store.js";

interface ArchiveResult {
  success: boolean;
  error?: string;
}

export async function archiveCommand(store: CardStore, slug: string): Promise<ArchiveResult> {
  try {
    await store.archiveCard(slug);
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
