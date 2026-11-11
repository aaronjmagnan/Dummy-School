import { routeFor } from "@/state/serve";

/** Every aeries endpoint (see src/vendors/aeries.ts). */
const handler = routeFor("aeries");
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
