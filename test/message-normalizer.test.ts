import { describe, expect, it } from "vitest";

import { normalizeEntity, normalizeMessage } from "../src/telegram/message-normalizer";

describe("normalizeMessage", () => {
  it("normalizes text, peer ids, and document metadata", () => {
    const normalized = normalizeMessage(
      {
        date: new Date("2026-03-21T10:30:00.000Z"),
        id: 42,
        media: {
          className: "MessageMediaDocument",
          document: {
            attributes: [
              {
                className: "DocumentAttributeFilename",
                fileName: "report.pdf"
              }
            ],
            mimeType: "application/pdf",
            size: 1024
          }
        },
        message: "hi",
        out: false,
        peerId: {
          userId: BigInt(123456789)
        },
        replyTo: {
          replyToMsgId: 10
        },
        senderId: BigInt(987654321)
      },
      true
    );

    expect(normalized).toEqual({
      chatId: "123456789",
      date: "2026-03-21T10:30:00.000Z",
      id: 42,
      media: {
        fileName: "report.pdf",
        mimeType: "application/pdf",
        size: 1024,
        type: "MessageMediaDocument"
      },
      messageId: 42,
      outgoing: false,
      peer: {
        id: "123456789",
        raw: {
          userId: "123456789"
        },
        ref: "123456789",
        type: "user"
      },
      raw: {
        date: "2026-03-21T10:30:00.000Z",
        id: 42,
        media: {
          className: "MessageMediaDocument",
          document: {
            attributes: [
              {
                className: "DocumentAttributeFilename",
                fileName: "report.pdf"
              }
            ],
            mimeType: "application/pdf",
            size: 1024
          }
        },
        message: "hi",
        out: false,
        peerId: {
          userId: "123456789"
        },
        replyTo: {
          replyToMsgId: 10
        },
        senderId: "987654321"
      },
      replyToMessageId: 10,
      senderId: "987654321",
      text: "hi"
    });
  });
});

describe("normalizeEntity", () => {
  it("maps usernames into reusable peer refs", () => {
    expect(
      normalizeEntity({
        id: BigInt(5),
        title: "Saved Messages",
        username: "savedmessages"
      })
    ).toEqual({
      id: "5",
      raw: undefined,
      ref: "@savedmessages",
      title: "Saved Messages",
      type: undefined,
      username: "savedmessages"
    });
  });
});
