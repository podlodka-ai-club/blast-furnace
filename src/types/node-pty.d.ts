declare module 'node-pty' {
  export interface IPtyProcess {
    onData(listener: (data: string) => void): void;
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
    kill(signal?: string): void;
  }

  export interface IPtyForkOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    name?: string;
  }

  export function spawn(file: string, args?: string[], options?: IPtyForkOptions): IPtyProcess;
}
