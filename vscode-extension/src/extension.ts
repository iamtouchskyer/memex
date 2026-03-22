import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("memex.mcpServer", {
      provideMcpServerDefinitions: async () => [
        new vscode.McpStdioServerDefinition(
          "Memex",
          "npx",
          ["-y", "@touchskyer/memex@latest", "mcp"],
          {},
          "0.1.8"
        ),
      ],
      resolveMcpServerDefinition: async (server) => server,
    })
  );
}
