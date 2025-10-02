import os from 'os';
import path from 'path';

const PIPE_NAME = 'airsync-lite-cli';

export function getCliBridgePath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${PIPE_NAME}`;
  }

  return path.join(os.tmpdir(), `${PIPE_NAME}.sock`);
}
