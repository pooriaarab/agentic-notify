import { storeContract } from "../testing.js";
import { MemoryStore } from "./store.js";

storeContract("memory", async () => new MemoryStore(), async (s) => s);
