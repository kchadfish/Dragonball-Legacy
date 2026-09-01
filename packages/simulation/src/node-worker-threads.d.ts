declare module "node:worker_threads" {
  export class MessagePort {
    postMessage(value: unknown): void;
    on(event: "message", listener: (value: unknown) => void): this;
    unref(): void;
  }

  export class MessageChannel {
    readonly port1: MessagePort;
    readonly port2: MessagePort;
  }

  export class Worker {
    constructor(
      filename: string | URL,
      options?: {
        readonly eval?: boolean;
        readonly execArgv?: readonly string[];
        readonly workerData?: unknown;
        readonly transferList?: readonly unknown[];
      },
    );
    postMessage(value: unknown): void;
    terminate(): Promise<number>;
    unref(): void;
  }

  export function receiveMessageOnPort(
    port: MessagePort,
  ): { readonly message: unknown } | undefined;
  export const parentPort: MessagePort | null;
  export const workerData: unknown;
}

declare const process: {
  readonly execArgv: readonly string[];
};
