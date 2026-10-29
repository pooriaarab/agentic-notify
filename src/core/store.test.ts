import { createMemoryStore } from "agentic-identity";
import { runStoreContract } from "agentic-identity/testing";

runStoreContract((options) => createMemoryStore(options));
