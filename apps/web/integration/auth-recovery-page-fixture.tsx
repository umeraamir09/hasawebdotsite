// Browser test bundle only. It mounts the production `AuthRecovery` callback
// page (the fixed `/auth/recovery` and `/auth/recovery/error` routes) so the
// Phase 15 continuation runs against the real guide and editor recovery
// records. The page shell and the provider hop are the harness's.

import { createRoot } from "react-dom/client";
import { AuthRecovery } from "../components/auth-recovery";
import "../app/globals.css";

const element = document.getElementById("root");
if (!element) throw new Error("Recovery root is missing");
createRoot(element).render(<AuthRecovery />);
