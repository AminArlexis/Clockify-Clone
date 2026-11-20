
import "@supabase/functions-js/edge-runtime.d.ts";

import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import { pipeline } from "@supabase/middleware";

import {
  withOAuthProtectedResource,
  withSupabase,
} from "@supabase/server";

import { z } from "zod";

Deno.serve(
  pipeline(
    [
      withOAuthProtectedResource(),
      withSupabase({ auth: "user" }),
    ],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: "timeflow",
          version: "0.1.0",
        });

        server.registerTool(
          "whoami",
          {
            description: "Get the identity of the authenticated TimeFlow user.",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          async () => {
            const { data, error } = await supabase.auth.getUser();

            if (error) {
              throw new Error(error.message);
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    id: data.user.id,
                    email: data.user.email,
                  }),
                },
              ],
            };
          },
        );

        return server;
      });

      return handler.fetch(req);
    },
  ),
);
