import { describe, expect, it } from "vitest";

import { parseHistoryRequest, parseSendRequest } from "../src/nodes/input-parsers";

describe("parseSendRequest", () => {
  it("uses text payload with a configured default peer", () => {
    const request = parseSendRequest(
      {
        payload: "hello there"
      },
      "@savedmessages"
    );

    expect(request).toEqual({
      caption: undefined,
      media: undefined,
      peer: "@savedmessages",
      text: "hello there"
    });
  });

  it("builds a media send request from a Buffer payload", () => {
    const request = parseSendRequest({
      payload: Buffer.from("test"),
      telegram: {
        caption: "photo",
        fileName: "image.jpg",
        peer: "@friend"
      }
    });

    expect(request.peer).toBe("@friend");
    expect(request.caption).toBe("photo");
    expect(request.media?.fileName).toBe("image.jpg");
    expect(Buffer.isBuffer(request.media?.file)).toBe(true);
  });
});

describe("parseHistoryRequest", () => {
  it("clamps the requested limit and keeps the peer override", () => {
    const request = parseHistoryRequest(
      {
        telegram: {
          limit: 500,
          peer: "@history-target"
        }
      },
      {
        includeRaw: false,
        limit: 10
      }
    );

    expect(request).toEqual({
      includeRaw: false,
      limit: 100,
      offsetId: undefined,
      peer: "@history-target"
    });
  });
});

