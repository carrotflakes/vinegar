import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let server;
let definitions;
let commands;

before(async () => {
  server = await createServer({ server: { middlewareMode: true } });
  ({ TOOL_DEFINITIONS: definitions } = await server.ssrLoadModule(
    "/src/toolDefinitions.ts"
  ));
  ({ COMMANDS: commands } = await server.ssrLoadModule(
    "/src/commands/registry.ts"
  ));
});

after(async () => server.close());

test("tool definitions generate the command list in toolbar order", () => {
  const toolCommands = commands.filter((command) =>
    command.id.startsWith("tool.")
  );
  assert.deepEqual(
    toolCommands.map((command) => command.id),
    definitions.map((tool) => `tool.${tool.id}`)
  );
  definitions.forEach((tool, index) => {
    assert.deepEqual(toolCommands[index].keys, [
      { key: tool.key, ...(tool.shift ? { shift: true } : {}) },
    ]);
  });
});
