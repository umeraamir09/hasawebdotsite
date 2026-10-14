import { health } from "@hasaweb/config";
export const dynamic = "force-dynamic";
export function GET() {
  return health("web");
}
