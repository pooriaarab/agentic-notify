/** Contract suite for the Store port. It comes from agentic-identity. Run it on every adapter. */
export { runStoreContract } from "agentic-identity/testing";

/** Mail adapter that keeps messages in memory. For tests only. */
export { TestEmailAdapter } from "./delivery/email.js";
