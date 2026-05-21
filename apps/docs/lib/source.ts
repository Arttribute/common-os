import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

export const source = loader({
  baseUrl: "/",
  source: (docs as unknown as { toFumadocsSource: () => Parameters<typeof loader>[0]["source"] }).toFumadocsSource(),
});
