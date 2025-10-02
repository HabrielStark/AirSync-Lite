import { EventEmitter } from 'events';
import { FileSystemWatcher, FileSystemWatcherOptions } from './FileSystemWatcher';
import { WatchEvent } from './EventTypes';

export interface PipelineOptions {
  watcher: FileSystemWatcherOptions;
}

export class WatcherPipeline extends EventEmitter {
  private readonly watcher: FileSystemWatcher;

  constructor(private readonly options: PipelineOptions) {
    super();
    this.watcher = new FileSystemWatcher(options.watcher);

    this.watcher.on('event', (event: WatchEvent) => {
      this.emit('event', event);
    });
    this.watcher.on('error', (error) => this.emit('error', error));
  }

  async start(): Promise<void> {
    await this.watcher.start();
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
  }

  async registerFolder(absolutePath: string): Promise<string> {
    return this.watcher.addFolder(absolutePath);
  }

  async unregisterFolder(folderId: string): Promise<void> {
    await this.watcher.removeFolder(folderId);
  }
}
