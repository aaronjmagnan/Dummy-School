import { routeFor } from "@/state/serve";

/** Every powerschool endpoint (see src/vendors/powerschool.ts). */
const handler = routeFor("powerschool");
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
