import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export class WorkflowCache {
  private _cacheFilePath: string;

  public get cacheFilePath(): string {
    return this._cacheFilePath;
  }

  constructor(filename: string) {
    const cacheDir = join(process.cwd(), "cache");
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir);
    }
    this._cacheFilePath = join(cacheDir, filename);
    this.ensureCacheExists();
  }

  private ensureCacheExists(): void {
    if (!existsSync(this._cacheFilePath)) {
      writeFileSync(this._cacheFilePath, JSON.stringify({ sent: [] }, null, 2));
    }
  }

  public hasBeenSent(workflowId: string): boolean {
    try {
      const data = JSON.parse(readFileSync(this._cacheFilePath, 'utf8'));
      return data.sent.includes(workflowId);
    } catch (error) {
      console.warn("Error reading cache file:", error);
      return false;
    }
  }

  public markAsSent(workflowIds: string[]): void {
    try {
      const data = JSON.parse(readFileSync(this._cacheFilePath, 'utf8'));
      const newSent = [...new Set([...data.sent, ...workflowIds])];
      writeFileSync(this._cacheFilePath, JSON.stringify({ sent: newSent }, null, 2));
    } catch (error) {
      console.error("Error updating cache file:", error);
      throw error;
    }
  }

  public filterNewWorkflows(workflowIds: string[]): string[] {
    return workflowIds.filter(id => !this.hasBeenSent(id));
  }
}
