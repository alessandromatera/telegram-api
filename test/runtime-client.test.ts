import { describe, expect, it, vi } from "vitest";
import bigInt from "big-integer";
import { Api } from "telegram";

import { TelegramRuntimeClient } from "../src/telegram/runtime-client";
import type { AuthStatus, TelegramClientLike } from "../src/telegram/types";

class ContextSensitiveClient implements TelegramClientLike {
  public readonly session = {
    save: () => "SESSION"
  };
  public readonly historyCalls: Record<string, unknown>[] = [];

  private readonly entities = new Map<string, unknown>();
  private readonly inputEntities = new Map<string, unknown>();
  private readonly dialogState?: { readInboxMaxId: number; unreadCount: number };
  private readonly historyMessages?: unknown[];

  constructor(options: {
    dialogState?: { readInboxMaxId: number; unreadCount: number };
    entities?: Array<[string, unknown]>;
    historyMessages?: unknown[];
    inputEntities?: Array<[string, unknown]>;
  } = {}) {
    for (const [key, value] of options.entities ?? []) {
      this.entities.set(key, value);
    }

    for (const [key, value] of options.inputEntities ?? []) {
      this.inputEntities.set(key, value);
    }

    this.dialogState = options.dialogState;
    this.historyMessages = options.historyMessages;
  }

  async disconnect(): Promise<void> {
    return;
  }

  get disconnected(): Promise<void> {
    return new Promise(() => {
      return;
    });
  }

  private handle(method: string, ...args: unknown[]): unknown {
    if (method === "getEntity") {
      const key = String(args[0]);
      if (this.entities.has(key)) {
        return this.entities.get(key);
      }

      throw new Error(`missing entity ${key}`);
    }

    if (method === "getInputEntity") {
      const key = String(args[0]);
      if (this.inputEntities.has(key)) {
        return this.inputEntities.get(key);
      }

      if (this.entities.has(key)) {
        return this.entities.get(key);
      }

      throw new Error(`missing input entity ${key}`);
    }

    if (method === "getMessages") {
      const [entity, options] = args as [Record<string, unknown>, Record<string, unknown>];
      this.historyCalls.push({ ...options });
      return this.historyMessages ?? [
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

    if (method === "invoke") {
      const [request] = args as [Record<string, unknown>];
      if (request.className !== "messages.GetPeerDialogs") {
        throw new Error(`unexpected request ${String(request.className)}`);
      }

      return {
        dialogs: this.dialogState ? [this.dialogState] : []
      };
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
    return this.handle("getEntity", input);
  }

  async getInputEntity(input: unknown): Promise<unknown> {
    return this.handle("getInputEntity", input);
  }

  async getMessages(entity: unknown, options: Record<string, unknown>): Promise<unknown[]> {
    return this.handle("getMessages", entity, options) as unknown[];
  }

  async invoke(request: unknown): Promise<unknown> {
    return this.handle("invoke", request);
  }

  async sendMessage(entity: unknown, options: Record<string, unknown>): Promise<unknown> {
    return this.handle("sendMessage", entity, options);
  }

  async start(): Promise<void> {
    return;
  }
}

class RejectingDisconnectClient implements TelegramClientLike {
  public readonly session = {
    save: () => "SESSION"
  };

  constructor(private readonly disconnectError: Error) {}

  addEventHandler(): void {
    return;
  }

  async disconnect(): Promise<void> {
    return;
  }

  get disconnected(): Promise<void> {
    return Promise.reject(this.disconnectError);
  }

  removeEventHandler(): void {
    return;
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
      peer: "@target",
      unreadOnly: false
    });

    expect(messages).toHaveLength(1);
    expect(messages.constructor).toBe(Array);
    expect(messages[0]?.text).toBe("history item");
    expect(messages[0]?.peer?.id).toBe("123");
  });

  it("returns only unread incoming history when requested", async () => {
    const entity = { id: 123, title: "Test Chat" };
    const inputEntity = new Api.InputPeerUser({ userId: 123, accessHash: bigInt(1) });
    const client = new ContextSensitiveClient({
      dialogState: {
        readInboxMaxId: 10,
        unreadCount: 2
      },
      entities: [["@target", entity]],
      historyMessages: [
        {
          id: 13,
          message: "new incoming 2",
          out: false,
          peer: entity,
          senderId: 99
        },
        {
          id: 12,
          message: "own reply",
          out: true,
          peer: entity,
          senderId: 10
        },
        {
          id: 11,
          message: "new incoming 1",
          out: false,
          peer: entity,
          senderId: 99
        }
      ],
      inputEntities: [["@target", inputEntity]]
    });
    const runtime = createRuntime(client);

    const messages = await runtime.getHistory({
      includeRaw: false,
      limit: 10,
      peer: "@target",
      unreadOnly: true
    });

    expect(messages.map((message) => message.text)).toEqual(["new incoming 2", "new incoming 1"]);
    expect(client.historyCalls[0]).toMatchObject({
      limit: 2,
      minId: 10,
      offsetId: undefined
    });
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

  it("treats rejected disconnect promises as reconnectable errors", async () => {
    const client = new RejectingDisconnectClient(new Error("socket closed"));
    const runtime = new TelegramRuntimeClient({
      apiHash: "hash",
      apiId: 123,
      phone: "+3900000000",
      reconnectMaxMs: 30000,
      reconnectMinMs: 2000,
      sessionString: "SESSION"
    });
    const markDisconnected = vi.fn();
    const scheduleReconnect = vi.fn();

    (runtime as any).sessionController = {
      connect: async () => client,
      getClient: () => client,
      getStatus: () => ({ label: "Connected", state: "connected" }),
      markDisconnected,
      onStatus: () => () => undefined
    };
    (runtime as any).scheduleReconnect = scheduleReconnect;

    (runtime as any).attachClient(client);
    await Promise.resolve();
    await Promise.resolve();

    expect(markDisconnected).toHaveBeenCalledWith("socket closed");
    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
  });
});
