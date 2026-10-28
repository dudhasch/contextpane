/**
 * WP4: the remediation drawer dissolved into the code rail (`components/shell/rail/`). No overlay is
 * mounted any more; this module keeps its old exports so existing imports resolve.
 */
import { CommercialCallout } from "../shell/rail/ScriptsTab";

export { PEER_TENANT_META, resolveOtherAffectedClients } from "../shell/rail/OtherTenantsPopover";

export function CommercialTab() {
  return <CommercialCallout ticketId="INC-4092" />;
}

/** @deprecated The drawer is the code rail's `staging` / `console` / `note` modes; renders nothing. */
export function ActionApprovalDrawerSheet(): null {
  return null;
}
