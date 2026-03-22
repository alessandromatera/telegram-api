import { describe, expect, it } from "vitest";

import { TelegramRuntimeClient } from "../src/telegram/runtime-client";
import type { AuthStatus, TelegramClientLike } from "../src/telegram/types";

class ContextSensitiveClient implements TelegramClientLike {
  public readonly session = {
    save: () => "SESSION"
  };

  private readonly entities = new Map<string, unknown>();

  constructor(options: { entities?: Array<[string, unknown]> } = {}) {
    for (const [key, value] of options.entities ?? []) {
      this.entities.set(key, value);
    }
  }

  async disconnect(): Promise<void> {
    return;
  }

  get disconnected(): Promise<void> {
    return new Promise(() => {
      return;
    });
  }

  invoke(method: string, ...args: unknown[]): unknown {
    if (method === "getEntity") {
      const key = String(args[0]);
      if (this.entities.has(key)) {
        return this.entities.get(key);
      }

      throw new Error(`missing entity ${key}`);
    }

    if (method === "getMessages") {
      const [entity, options] = args as [Record<string, unknown>, Record<string, unknown>];
      return [
        {
          id: 1,
          message: "history item",
          out: false,
          peer: entity,
          senderId: 10,
          ...options
        }
      ];
    }

    if (method === "sendMessage") {
      const [entity, options] = args as [Record<string, unknown>, Record<string, unknown>];
      return {
        id: 99,
        message: String(options.message ?? ""),
        out: true,
        peer: entity,
        senderId: 10
      };
    }

    throw new Error(`unexpected method ${method}`);
  }

  async getEntity(input: unknown): Promise<unknown> {
    return this.invoke("getEntity", input);
  }

  async getMessages(entity: unknown, options: Record<string, unknown>): Promise<unknown[]> {
    return this.invoke("getMessages", entity, options) as Promise<unknown[]>;
  }

  async sendMessage(entity: unknown, options: Record<string, unknown>): Promise<unknown> {
    return this.invoke("sendMessage", entity, options);
  }

  async start(): Promise<void> {
    return;
  }
}

function createRuntime(client: TelegramClientLike, status: AuthStatus = { label: "Connected", state: "connected" }): TelegramRuntimeClient {
  const runtime = new TelegramRuntimeClient({
    apiHash: "hash",
    apiId: 123,
    phone: "+3900000000",
    reconnectMaxMs: 30000,
    reconnectMinMs: 2000,
    sessionString: "SESSION"
  });

  (runtime as any).sessionController = {
    connect: async () => client,
    getClient: () => client,
    getStatus: () => status,
    onStatus: () => () => undefined
  };

  return runtime;
}

describe("TelegramRuntimeClient", () => {
  it("keeps the Telegram client context when reading history", async () => {
    const entity = { id: 123, title: "Test Chat" };
    const runtime = createRuntime(
      new ContextSensitiveClient({
        entities: [["@target", entity]]
      })
    );

    const messages = await runtime.getHistory({
      includeRaw: false,
      limit: 10,
      peer: "@target"
    });

    expect(messages).toHaveLength(1);
    expect(messages.constructor).toBe(Array);
    expect(messages[0]?.text).toBe("history item");
    expect(messages[0]?.peer?.id).toBe("123");
  });

  it("keeps the Telegram client context when sending text", async () => {
    const entity = { id: 321, title: "Send Chat" };
    const runtime = createRuntime(
      new ContextSensitiveClient({
        entities: [["@send-target", entity]]
      })
    );

    const message = await runtime.send({
      peer: "@send-target",
      text: "hello"
    });

    expect(message.text).toBe("hello");
    expect(message.outgoing).toBe(true);
    expect(message.peer?.id).toBe("321");
  });
});
