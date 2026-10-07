import { beforeEach, describe, expect, it, vi } from "vitest";

// El cliente real arrastra Expo y no carga en Node; basta con la forma que usa
// `extractWithRetry`: un `post` y un `ApiError` con `status`.
const post = vi.fn();
vi.mock("../src/lib/api/client", () => {
  class ApiError extends Error {
    readonly status: number | null;
    constructor(status: number | null) {
      super(`status ${status}`);
      this.status = status;
    }
  }
  return { api: { post: (...args: unknown[]) => post(...args) }, ApiError };
});

import { ApiError } from "../src/lib/api/client";
import { extractWithRetry } from "../src/lib/api/bookmarks";

const error = (status: number | null) => new (ApiError as unknown as new (s: number | null) => Error)(status);

describe("extractWithRetry", () => {
  beforeEach(() => {
    post.mockReset();
  });

  it("un 404 es que el create aun no llego al servidor: espera y vuelve a intentar", async () => {
    // Pasa justo despues de compartir: el bookmark se escribio en local y la
    // operacion sigue en cola. Rendirse aqui dejaba el enlace "extrayendo".
    post.mockRejectedValueOnce(error(404)).mockRejectedValueOnce(error(404)).mockResolvedValueOnce(undefined);
    const esperas: number[] = [];
    await extractWithRetry("b1", async (ms) => void esperas.push(ms));
    expect(post).toHaveBeenCalledTimes(3);
    expect(esperas).toHaveLength(2);
  });

  it("se rinde tras agotar los intentos, sin lanzar", async () => {
    post.mockRejectedValue(error(404));
    await expect(extractWithRetry("b1", async () => {})).resolves.toBeUndefined();
    expect(post.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("otro error (sin red, 500) no se reintenta aqui: el lector lo reintenta al abrir", async () => {
    post.mockRejectedValue(error(500));
    await extractWithRetry("b1", async () => {});
    expect(post).toHaveBeenCalledTimes(1);
  });
});
