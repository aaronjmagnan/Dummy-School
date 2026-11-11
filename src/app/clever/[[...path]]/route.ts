import { routeFor } from "@/state/serve";

/** Every clever endpoint (see src/vendors/clever.ts). */
const handler = routeFor("clever");
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
