import { describe, expect, it } from "vitest";
import { isLocalStack } from "./localStack";

describe("isLocalStack", () => {
  it("is true only on the machine running the stack", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"]) {
      expect(isLocalStack(host)).toBe(true);
    }
  });

  it("is false over the network, because those ports are not published there", () => {
    // docker-compose.yml binds every non-webapp port to 127.0.0.1 on
    // purpose, so a phone reaching the app at the machine's LAN address
    // cannot open Jupyter, Airflow or either service's docs. Widening
    // this to private ranges showed four links that could not work.
    for (const host of ["10.0.0.218", "192.168.1.40", "172.16.0.9", "asdaqs-mac.local"]) {
      expect(isLocalStack(host)).toBe(false);
    }
  });

  it("is false for a deployed domain", () => {
    for (const host of ["vfr.example.com", "example.com", "8.8.8.8"]) {
      expect(isLocalStack(host)).toBe(false);
    }
  });

  it("is not fooled by a hostname that merely contains one", () => {
    expect(isLocalStack("localhost.evil.com")).toBe(false);
    expect(isLocalStack("notlocalhost")).toBe(false);
  });
});
