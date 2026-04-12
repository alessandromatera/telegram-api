import { describe, expect, it } from "vitest";

import { SessionController } from "../src/telegram/session-controller";
import type { ConnectionCredentials, TelegramClientLike, TelegramStartOptions } from "../src/telegram/types";

class FakeClient implements TelegramClientLike {
  public readonly session = {
    save: () => this.savedSession
  };

  private readonly flow: "session" | "code" | "password";
  private readonly savedSession: string;

  constructor(flow: "session" | "code" | "password", savedSession = "SESSION") {
    this.flow = flow;
    this.savedSession = savedSession;
  }

  async disconnect(): Promise<void> {
    return;
  }

  async start(options: TelegramStartOptions): Promise<void> {
    void options.phoneNumber();

    if (this.flow === "session") {
      return;
    }

    const code = await options.phoneCode();
    if (code !== "12345") {
      options.onError(new Error("Invalid code"));
      throw new Error("Invalid code");
    }

    if (this.flow === "password") {
      const password = await options.password();
      if (password !== "secret") {
        options.onError(new Error("Invalid password"));
        throw new Error("Invalid password");
      }
    }
  }
}

class StartFailureClient implements TelegramClientLike {
  public readonly session = {
    save: () => "SESSION"
  };

  async disconnect(): Promise<void> {
    return;
  }

  async start(options: TelegramStartOptions): Promise<void> {
    void options.phoneNumber();
    options.onError(new Error("WAN down"));
    throw new Error("WAN down");
  }
}

function credentials(): ConnectionCredentials {
  return {
    apiHash: "api-hash",
    apiId: 12345,
    phone: "+3900000000"
  };
}

describe("SessionController", () => {
  it("waits for a login code and captures the session string", async () => {
    const controller = new SessionController({
      clientFactory: () => new FakeClient("code", "CODE-SESSION")
    });

    const connectPromise = controller.connect(credentials());
    const awaitingCode = await controller.waitForState(["awaiting_code"], 100);

    expect(awaitingCode.state).toBe("awaiting_code");

    await controller.submitCode("12345");
    const client = await connectPromise;

    expect(client.session.save()).toBe("CODE-SESSION");
    expect(controller.getStatus()).toEqual({
      error: undefined,
      label: "Connected",
      sessionString: "CODE-SESSION",
      state: "connected"
    });
  });

  it("supports 2FA password prompts after the login code", async () => {
    const controller = new SessionController({
      clientFactory: () => new FakeClient("password", "PASSWORD-SESSION")
    });

    const connectPromise = controller.connect(credentials());
    await controller.waitForState(["awaiting_code"], 100);
    await controller.submitCode("12345");

    const awaitingPassword = await controller.waitForState(["awaiting_password"], 100);
    expect(awaitingPassword.state).toBe("awaiting_password");

    await controller.submitPassword("secret");
    await connectPromise;

    expect(controller.getStatus().sessionString).toBe("PASSWORD-SESSION");
  });

  it("does not leak background auth failures as unhandled rejections", async () => {
    const controller = new SessionController({
      clientFactory: () => new StartFailureClient()
    });
    const unhandled: unknown[] = [];
    const handleUnhandled = (error: unknown) => {
      unhandled.push(error);
    };

    process.on("unhandledRejection", handleUnhandled);

    try {
      controller.startConnect(credentials());

      const errorStatus = await controller.waitForState(["error"], 100);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorStatus.state).toBe("error");
      expect(errorStatus.error).toBe("WAN down");
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", handleUnhandled);
    }
  });
});
