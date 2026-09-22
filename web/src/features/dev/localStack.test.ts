import { describe, expect, it } from "vitest";
import { isLocalStack } from "./localStack";

describe("isLocalStack", () => {
  it("is true for the machine running the stack", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
      expect(isLocalStack(host)).toBe(true);
    }
  });

  it("is true for that machine reached over the network", () => {
    // The case that was wrong: a phone on the same desk types the
    // machine's LAN address, and the console dropped four of its five
    // links even though the ports were open.
    for (const host of ["10.0.0.218", "192.168.1.40", "172.16.0.9", "172.31.255.254", "169.254.4.4"]) {
      expect(isLocalStack(host)).toBe(true);
    }
  });

  it("is true for an mDNS name", () => {
    expect(isLocalStack("asdaqs-mac.local")).toBe(true);
    expect(isLocalStack("ASDAQS-MAC.LOCAL")).toBe(true);
  });

  it("is false for anything reachable from outside", () => {
    // These links point at ports docker-compose publishes locally.
    // On a real deployment they are wrong, and offering them would
    // send a reader to a port that is not open.
    for (const host of ["vfr.example.com", "example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1"]) {
      expect(isLocalStack(host)).toBe(false);
    }
  });

  it("does not mistake a hostname that merely contains a private range", () => {
    expect(isLocalStack("10.0.0.218.evil.com")).toBe(false);
    expect(isLocalStack("local")).toBe(false);
    expect(isLocalStack("notlocalhost")).toBe(false);
  });
});
